import { Service, PlatformAccessory, Units, CharacteristicValue, HAPStatus } from 'homebridge';
import { MerossCloudPlatform } from '../platform';
import { interval, Subject } from 'rxjs';
import { skipWhile } from 'rxjs/operators';
import { DeviceDefinition, MerossCloudDevice } from 'meross-cloud';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Meter {
  private service: Service;
  temperatureservice?: Service;
  humidityservice?: Service;

  CurrentRelativeHumidity!: CharacteristicValue;
  CurrentTemperature!: CharacteristicValue;
  BatteryLevel!: CharacteristicValue;
  ChargingState!: CharacteristicValue;
  StatusLowBattery!: CharacteristicValue;
  Active!: CharacteristicValue;
  WaterLevel!: CharacteristicValue;

  meterUpdateInProgress!: boolean;
  doMeterUpdate!: Subject<unknown>;
  devicestatus: any;
  OnOff: any;

  constructor(
    private readonly platform: MerossCloudPlatform,
    private accessory: PlatformAccessory,
    public device: MerossCloudDevice,
    public deviceId: DeviceDefinition['uuid'],
    public deviceDef: DeviceDefinition,
  ) {
    // default placeholders
    this.BatteryLevel = 0;
    this.ChargingState = 2;
    this.StatusLowBattery = this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    this.CurrentRelativeHumidity = 0;
    this.CurrentTemperature = 0;

    // this is subject we use to track when we need to POST changes to the SwitchBot API
    this.doMeterUpdate = new Subject();
    this.meterUpdateInProgress = false;

    // Retrieve initial values and updateHomekit
    this.refreshStatus();

    // set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'SwitchBot')
      .setCharacteristic(this.platform.Characteristic.Model, 'SWITCHBOT-METERTH-S1')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, deviceDef.uuid);

    // get the Battery service if it exists, otherwise create a new Battery service
    // you can create multiple services for each accessory
    (this.service =
      accessory.getService(this.platform.Service.Battery) ||
      accessory.addService(this.platform.Service.Battery)), '%s %s', deviceDef.devName, deviceDef.deviceType;

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // accessory.getService('NAME') ?? accessory.addService(this.platform.Service.Battery, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Battery

    // create handlers for required characteristics
    this.service.setCharacteristic(this.platform.Characteristic.ChargingState, 2);

    // Temperature Sensor Service
    if (this.platform.config.options?.meter?.hide_temperature) {
      if (this.platform.debugMode) {
        this.platform.log.error('Removing service');
      }
      this.temperatureservice = this.accessory.getService(this.platform.Service.TemperatureSensor);
      accessory.removeService(this.temperatureservice!);
    } else if (!this.temperatureservice) {
      if (this.platform.debugMode) {
        this.platform.log.warn('Adding service');
      }
      (this.temperatureservice =
        this.accessory.getService(this.platform.Service.TemperatureSensor) ||
        this.accessory.addService(this.platform.Service.TemperatureSensor)), '%s TemperatureSensor', accessory.displayName;

      this.temperatureservice
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .setProps({
          unit: Units['CELSIUS'],
          validValueRanges: [-273.15, 100],
          minValue: -273.15,
          maxValue: 100,
          minStep: 0.1,
        })
        .onGet(() => {
          return this.CurrentTemperature;
        });
    } else {
      if (this.platform.debugMode) {
        this.platform.log.warn('TemperatureSensor not added.');
      }
    }

    // Humidity Sensor Service
    if (this.platform.config.options?.meter?.hide_humidity) {
      if (this.platform.debugMode) {
        this.platform.log.error('Removing service');
      }
      this.humidityservice = this.accessory.getService(this.platform.Service.HumiditySensor);
      accessory.removeService(this.humidityservice!);
    } else if (!this.humidityservice) {
      (this.humidityservice =
        this.accessory.getService(this.platform.Service.HumiditySensor) ||
        this.accessory.addService(this.platform.Service.HumiditySensor)), '%s HumiditySensor', accessory.displayName;

      this.humidityservice
        .getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
        .setProps({
          minStep: 0.1,
        })
        .onGet(() => {
          return this.CurrentRelativeHumidity;
        });
    } else {
      if (this.platform.debugMode) {
        this.platform.log.warn('HumiditySensor not added.');
      }
    }

    // Retrieve initial values and updateHomekit
    this.updateHomeKitCharacteristics();

    // Start an update interval
    interval(this.platform.config.options!.refreshRate! * 1000)
      .pipe(skipWhile(() => this.meterUpdateInProgress))
      .subscribe(() => {
        this.refreshStatus();
      });
  }

  /**
   * Parse the device status from the SwitchBot api
   */
  parseStatus() {
    // Set Room Sensor State
    if (this.devicestatus.body) {
      this.BatteryLevel = 100;
    } else {
      this.BatteryLevel = 10;
    }
    if (this.BatteryLevel < 15) {
      this.StatusLowBattery = 1;
    } else {
      this.StatusLowBattery = 0;
    }
    // Current Relative Humidity
    if (!this.platform.config.options?.meter?.hide_humidity) {
      this.CurrentRelativeHumidity = this.devicestatus.body.humidity!;
      this.platform.log.debug('Meter %s - Humidity: %s%', this.accessory.displayName, this.CurrentRelativeHumidity);
    }

    // Current Temperature
    if (!this.platform.config.options?.meter?.hide_temperature) {
      if (this.platform.config.options?.meter?.unit === 1) {
        this.CurrentTemperature = this.toFahrenheit(this.devicestatus.body.temperature!);
      } else if (this.platform.config.options?.meter?.unit === 0) {
        this.CurrentTemperature = this.toCelsius(this.devicestatus.body.temperature!);
      } else {
        this.CurrentTemperature = this.devicestatus.body.temperature!;
      }
      this.platform.log.debug('Meter %s - Temperature: %s°c', this.accessory.displayName, this.CurrentTemperature);
    }
  }

  /**
   * Asks the SwitchBot API for the latest device information
   */
  async refreshStatus() {
    this.device.getSystemAllData((error, result) => {
      this.platform.log.debug('All-Data Refresh: ' + JSON.stringify(result));
      if (error) {
        this.platform.log.error('Error: ' + JSON.stringify(error));
      }
      this.devicestatus = result;
      for (const onoff of this.devicestatus.all.digest.togglex) {
        this.platform.log.debug(onoff);
        this.OnOff = onoff.onoff;
      }
      this.updateFirmware(result);
      try {
        this.parseStatus();
        this.updateHomeKitCharacteristics();
      } catch (e) {
        this.platform.log.error(
          '%s: - Failed to update status.',
          this.accessory.displayName,
          JSON.stringify(e.message),
          this.platform.log.debug(
            '%s: Error -',
            this.accessory.displayName,
            JSON.stringify(e)),
        );
      }
    });
  }


  private updateFirmware(result: Record<any, any>) {
    if (this.platform.config.firmware){
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision).updateValue(this.platform.FirmwareOverride);
    } else {
      this.accessory
        .getService(this.platform.Service.AccessoryInformation)!
        .getCharacteristic(this.platform.Characteristic.FirmwareRevision).updateValue(result.all.system.firmware.version);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    if (this.StatusLowBattery !== undefined) {
      this.service.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, this.StatusLowBattery);
    }
    if (this.BatteryLevel !== undefined) {
      this.service.updateCharacteristic(this.platform.Characteristic.BatteryLevel, this.BatteryLevel);
    }
    if (!this.platform.config.options?.meter?.hide_humidity && this.CurrentRelativeHumidity !== undefined) {
      this.humidityservice?.updateCharacteristic(
        this.platform.Characteristic.CurrentRelativeHumidity,
        this.CurrentRelativeHumidity,
      );
    }
    if (!this.platform.config.options?.meter?.hide_temperature && this.CurrentTemperature !== undefined) {
      this.temperatureservice?.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        this.CurrentTemperature,
      );
    }
  }

  public apiError(e: any) {
    this.service.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, e);
    this.service.updateCharacteristic(this.platform.Characteristic.BatteryLevel, e);
    if (!this.platform.config.options?.meter?.hide_humidity) {
      this.humidityservice?.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, e);
    }
    if (!this.platform.config.options?.meter?.hide_temperature) {
      this.temperatureservice?.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, e);
    }
    new this.platform.api.hap.HapStatusError(HAPStatus.OPERATION_TIMED_OUT);
  }

  /**
   * Converts the value to celsius if the temperature units are in Fahrenheit
   */
  toCelsius(value: number) {
    // celsius should be to the nearest 0.5 degree
    return Math.round((5 / 9) * (value - 32) * 2) / 2;
  }

  /**
   * Converts the value to fahrenheit if the temperature units are in Fahrenheit
   */
  toFahrenheit(value: number) {
    return Math.round((value * 9) / 5 + 32);
  }
}
