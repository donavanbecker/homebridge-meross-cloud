/* eslint-disable @typescript-eslint/no-unused-vars */
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { MerossCloudPlatform } from '../platform';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';
import { DeviceDefinition, MerossCloudDevice } from 'meross-cloud';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class mss110 {
  private service!: Service;

  On!: CharacteristicValue;
  OutletInUse!: CharacteristicValue;
  OutletUpdate: Subject<unknown>;
  OutletUpdateInProgress: boolean;
  devicestatus!: Record<any, any>;
  OnOff!: number;

  constructor(
    private readonly platform: MerossCloudPlatform,
    private accessory: PlatformAccessory,
    public device: MerossCloudDevice,
    public deviceId: DeviceDefinition['uuid'],
    public deviceDef: DeviceDefinition,
  ) {
    // default placeholders
    this.On = false;
    this.OutletInUse = false;

    // this is subject we use to track when we need to POST changes to the SwitchBot API
    this.OutletUpdate = new Subject();
    this.OutletUpdateInProgress = false;

    // Retrieve initial values and updateHomekit
    this.refreshStatus();

    // set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Meross')
      .setCharacteristic(this.platform.Characteristic.Model, deviceDef.deviceType)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, deviceDef.uuid)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, '4.1.14');

    // get the LightBulb service if it exists, otherwise create a new Outlet service
    // you can create multiple services for each accessory
    // {"type":"Switch","devName":"Nursery Lamps","devIconId":"device001"}

    this.platform.log.debug('Setting Up %s ', deviceDef.devName, JSON.stringify(deviceDef));
    (this.service = this.accessory.getService(deviceDef.devName)
      || this.accessory.addService(this.platform.Service.Outlet, deviceDef.devName, deviceDef.devName)),
    `${deviceDef.devName} ${deviceDef.deviceType}`;

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Outlet, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.


    this.service.setCharacteristic(this.platform.Characteristic.Name, `${deviceDef.devName} ${deviceDef.deviceType}`);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Outlet

    // create handlers for required characteristics
    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        this.OnSet(value);
      });

    this.service
      .getCharacteristic(this.platform.Characteristic.OutletInUse)
      .onGet(async () => {
        return this.OutletInUse;
      });

    // Retrieve initial values and updateHomekit
    this.updateHomeKitCharacteristics();

    // Start an update interval
    interval(this.platform.config.refreshRate! * 1000)
      .pipe(skipWhile(() => this.OutletUpdateInProgress))
      .subscribe(() => {
        this.refreshStatus();
      });

    // Watch for Outlet change events
    // We put in a debounce of 100ms so we don't make duplicate calls
    this.OutletUpdate.pipe(
      tap(() => {
        this.OutletUpdateInProgress = true;
      }),
      debounceTime(100),
    ).subscribe(async () => {
      try {
        await this.pushChanges();
      } catch (e) {
        this.platform.log.error('ERROR: ', JSON.stringify(e.message));
        this.platform.log.debug('ERROR: %s %s -', this.deviceDef.deviceType, this.accessory.displayName, JSON.stringify(e));
      }
      this.OutletUpdateInProgress = false;
    });
  }

  /**
   * Parse the device status from the SwitchBot api
   */
  parseStatus() {
    if (this.OnOff === 0) {
      this.On = false;
    } else if (this.OnOff === 1) {
      this.On = true;
    }
    this.OutletInUse === true;
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
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision).updateValue(result.all.system.firmware.version);
  }

  /**
   * Pushes the requested changes to the SwitchBot API
   */
  async pushChanges() {
    setTimeout(() => {
      this.platform.log.info('Toggle %s to %s', this.accessory.displayName, this.On);
      this.device.controlToggleX(0, Boolean(this.On), (err, res) => {
        this.platform.log.debug('Toggle Response: err: ' + err + ', res: ' + JSON.stringify(res.all));
        this.refreshStatus();
      });
    }, 2000);
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    if (this.On !== undefined) {
      this.service.updateCharacteristic(this.platform.Characteristic.On, this.On);
    }
    if (this.OutletInUse !== undefined) {
      this.service.updateCharacteristic(this.platform.Characteristic.OutletInUse, this.OutletInUse);
    }
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  private async OnSet(value: CharacteristicValue) {
    this.platform.log.debug('%s Triggered SET On:', this.accessory.displayName, value);

    this.On = value;
    await this.pushChanges();
  }
}
