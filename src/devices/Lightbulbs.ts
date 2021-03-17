import { Service, PlatformAccessory, CharacteristicValue, HAPStatus } from 'homebridge';
import { MerossCloudPlatform } from '../platform';
import { interval } from 'rxjs';
import {
  numberToColour,
  RGBToHSL,
  colourToNumber,
  HSLToRGB,
  PLATFORM_NAME,
} from '../settings';

export class lightBulb {
  private service: Service;

  On!: CharacteristicValue;
  Saturation?: CharacteristicValue;
  Brightness!: CharacteristicValue;
  ColorTemperature?: CharacteristicValue;
  Hue?: CharacteristicValue;

  deviceStatus: any;
  devicestatus: any;
  OnOff: any;
  Data;
  Payload: any;
  mr_temp!: number;
  rgb_d: any;

  constructor(
    private readonly platform: MerossCloudPlatform,
    private accessory: PlatformAccessory,
    public device,
  ) {
    // default placeholders
    switch (device.model) {
      case 'MSL-100':
      case 'MSL-420':
      case 'MSL-120':
      case 'msl320m':
        this.On = false;
        this.Brightness = 0;
        this.Hue = 0;
        this.Saturation = 0;
        this.ColorTemperature = 140;
        break;
      case 'MSS560':
      case 'MSS570x':
      default:
        this.On = false;
        this.Brightness = 0;
    }

    // Retrieve initial values and updateHomekit
    this.refreshStatus();

    // set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, PLATFORM_NAME)
      .setCharacteristic(this.platform.Characteristic.Model, this.device.model!)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.serialNumber || device.deviceUrl!)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, device.firmwareRevision || device.deviceUrl!);

    // get the WindowCovering service if it exists, otherwise create a new WindowCovering service
    // you can create multiple services for each accessory
    (this.service =
      accessory.getService(this.platform.Service.Lightbulb) ||
      accessory.addService(this.platform.Service.Lightbulb)), device.name!;

    // Set Name Characteristic
    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name!);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/WindowCovering

    // create handlers for required characteristics
    this.service
      .getCharacteristic(this.platform.Characteristic.Brightness)
      .onSet(this.BrightnessSet.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.OnSet.bind(this));

    switch (device.model) {
      case 'MSL-100':
      case 'MSL-420':
      case 'MSL-120':
      case 'MSL-320':
      case 'msl320m':
        this.service
          .getCharacteristic(this.platform.Characteristic.Hue)
          .onSet(this.HueSet.bind(this));
        this.service
          .getCharacteristic(this.platform.Characteristic.ColorTemperature)
          .onSet(this.ColorTemperatureSet.bind(this));
        this.service
          .getCharacteristic(this.platform.Characteristic.Saturation)
          .onSet(this.SaturationSet.bind(this));
        break;
      case 'MSS560':
      case 'MSS570x':
      default:
    }

    // Update Homekit
    this.updateHomeKitCharacteristics();

    // Start an update interval
    interval(this.platform.config.refreshRate! * 1000)
      .subscribe(() => {
        this.refreshStatus();
      });
  }

  parseStatus() {
    switch (this.device.model) {
      case 'MSS110-1':
        if (this.deviceStatus) {
          const onOff = this.deviceStatus.payload.all.control.toggle.onoff;

          this.platform.log.debug('Retrieved status successfully: ', onOff);
          this.On = onOff;
        } else {
          this.platform.log.debug('Retrieved status unsuccessfully.');
          this.On = false;
        }
        break;
      default:
        if (this.deviceStatus) {
          if (this.deviceStatus?.payload?.all?.digest?.togglex) {
            const onOff = this.deviceStatus.payload.all.digest.togglex[`${this.device.channel}`].onoff;
            this.platform.log.debug('Retrieved status successfully: ', onOff);
            this.On = onOff;
          } else {
            this.platform.log.debug('Retrieved status unsuccessfully.');
            this.On = false;
          }
          if (this.deviceStatus?.payload?.all?.digest?.light?.luminance) {
            const luminance = this.deviceStatus.payload.all.digest.light.luminance;
            this.platform.log.debug('Retrieved status successfully: ', luminance);
            this.Brightness = luminance;
          } else {
            this.platform.log.debug('Retrieved status unsuccessfully.');
            this.Brightness = this.On ? 100 : 0;
          }
          if (this.deviceStatus?.payload?.all?.digest?.light?.temperature) {
            const tmp_temperature = this.deviceStatus.payload.all.digest.light.temperature;
            let mr_temp = (tmp_temperature / 100) * 360;
            mr_temp = 360 - mr_temp;
            mr_temp = mr_temp + 140;
            mr_temp = Math.round(mr_temp);
            this.ColorTemperature = mr_temp;
            this.platform.log.debug(
              'Retrieved temp status successfully: ',
              this.ColorTemperature,
            );
          }
          if (this.deviceStatus?.payload?.all?.digest?.light) {
            this.platform.log.debug(
              'Retrieved status successfully: ',
              this.deviceStatus.response.payload.all.digest.light,
            );

            const light_rgb = this.deviceStatus.payload.all.digest.light.rgb;
            const rgb = numberToColour(light_rgb);
            const hsl = RGBToHSL(rgb[0], rgb[1], rgb[2]);
            const hue = hsl[0];
            this.platform.log.debug('Retrieved hue status successfully: ', hue);
            this.Hue = hue;
          } else {
            this.platform.log.debug('Retrieved status unsuccessfully.');
          }
          if (this.deviceStatus?.payload?.all?.digest?.light) {
            this.Brightness = this.deviceStatus.payload.all.digest.light.luminance;
            this.ColorTemperature = this.deviceStatus.payload.all.digest.light.temperature;

            const light_rgb = this.deviceStatus.payload.all.digest.light.rgb;
            const rgb = numberToColour(light_rgb);
            const hsl = RGBToHSL(rgb[0], rgb[1], rgb[2]);
            const saturation = hsl[1];
            this.platform.log.debug(
              'Retrieved saturation status successfully: ',
              saturation,
            );
            this.platform.log.debug(
              'Retrieved saturation/hue status successfully: ',
              this.Hue,
            );
            this.Saturation = saturation;
          } else {
            this.platform.log.debug('Retrieved status unsuccessfully.');
            this.Saturation = this.On ? 100 : 0;
          }
        }
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
 * Pushes the requested changes to the Meross Device
 */
  async pushOnChanges() {

    this.Payload = {
      togglex: {
        onoff: this.On ? 1 : 0,
        channel: `${this.device.channel}`,
      },
    };

    // Data Info
    this.Data = {
      payload: this.Payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: 'Appliance.Control.ToggleX',
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
      },
    };
  }

  async pushBrightnessChanges() {

    if (this.Brightness === undefined) {
      //value is actually not defined, we cannot make a valid request for this one...
      return;
    }

    // Payload
    switch (this.device.model) {
      case 'MSL-100':
      case 'MSL-120':
      case 'MSL-320':
      case 'msl320m':
      case 'MSL-420':
        // Payload
        this.Payload = {
          light: {
            luminance: Number(this.Brightness),
            capacity: 4,
          },
        };
        break;
      case 'MSS560':
      case 'MSS570x':
      default:
        this.Payload = {
          light: {
            luminance: Number(this.Brightness),
          },
        };
    }

    // Data Info
    this.Data = {
      payload: this.Payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: 'Appliance.Control.Light',
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
      },
    };
  }

  async pushColorTemperatureChanges() {

    if (this.ColorTemperature === undefined || this.ColorTemperature < 140) {
      //value is actually not defined / invalid, we cannot make a valid request for this one...
      return;
    }

    this.mr_temp = Number(this.ColorTemperature) - 140;
    this.mr_temp = 360 - this.mr_temp;
    this.mr_temp = this.mr_temp / 360;
    this.mr_temp = Math.round(this.mr_temp * 100);
    this.mr_temp = this.mr_temp === 0 ? 1 : this.mr_temp;

    // Payload
    this.Payload = {
      light: {
        temperature: this.mr_temp,
        capacity: 2,
      },
    };

    // Data Info
    this.Data = {
      payload: this.Payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: 'Appliance.Control.Light',
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
      },
    };
  }

  async pushSaturationChanges() {

    if (this.Hue === undefined || this.Saturation === undefined) {
      //value is actually not defined / invalid, we cannot make a valid request for this one...
      return;
    }

    const rgb = HSLToRGB(this.Hue, this.Saturation, 50);
    this.rgb_d = colourToNumber(rgb[0], rgb[1], rgb[2]);

    // Payload
    this.Payload = {
      light: {
        rgb: this.rgb_d,
        capacity: 1,
        luminance: Number(this.Brightness),
      },
    };

    // Data Info
    this.Data = {
      payload: this.Payload,
      header: {
        messageId: `${this.device.messageId}`,
        method: 'SET',
        from: `http://${this.device.deviceUrl}/config`,
        namespace: 'Appliance.Control.Light',
        timestamp: this.device.timestamp,
        sign: `${this.device.sign}`,
        payloadVersion: 1,
      },
    };
  }

  updateHomeKitCharacteristics() {
    switch (this.device.model) {
      case 'MSL-100':
      case 'MSL-120':
      case 'MSL-320':
      case 'msl320m':
      case 'MSL-420':
        if (this.On !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.On, this.On);
        }
        if (this.Brightness !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.Brightness);
        }
        if (this.Saturation !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.Saturation, this.Saturation);
        }
        if (this.ColorTemperature !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.ColorTemperature, this.ColorTemperature);
        }
        if (this.Hue !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.Hue, this.Hue);
        }
        break;
      case 'MSS560':
      case 'MSS570x':
      default:
        if (this.On !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.On, this.On);
        }
        if (this.Brightness !== undefined) {
          this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.Brightness);
        }
    }
  }

  public apiError(e: any) {
    switch (this.device.model) {
      case 'MSL-100':
      case 'MSL-120':
      case 'MSL-320':
      case 'msl320m':
      case 'MSL-420':
        this.service.updateCharacteristic(this.platform.Characteristic.On, e);
        this.service.updateCharacteristic(this.platform.Characteristic.Brightness, e);
        this.service.updateCharacteristic(this.platform.Characteristic.Saturation, e);
        this.service.updateCharacteristic(this.platform.Characteristic.ColorTemperature, e);
        this.service.updateCharacteristic(this.platform.Characteristic.Hue, e);
        break;
      case 'MSS560':
      case 'MSS570x':
      default:
        this.service.updateCharacteristic(this.platform.Characteristic.On, e);
        this.service.updateCharacteristic(this.platform.Characteristic.Brightness, e);
    }
    new this.platform.api.hap.HapStatusError(HAPStatus.OPERATION_TIMED_OUT);
  }

  /**
   * Handle requests to set the value of the "On" characteristic
   */
  OnSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set On: %s', this.device.model, this.accessory.displayName, value);

    this.On = value;
    this.pushOnChanges();
  }

  /**
   * Handle requests to set the value of the "Brightness" characteristic
   */
  BrightnessSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set Brightness: %s', this.device.model, this.accessory.displayName, value);

    this.Brightness = value;
    this.pushBrightnessChanges();
  }

  /**
   * Handle requests to set the value of the "ColorTemperature" characteristic
   */
  ColorTemperatureSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set ColorTemperature: %s', this.device.model, this.accessory.displayName, value);

    this.ColorTemperature = value;
    this.pushColorTemperatureChanges();
  }

  /**
   * Handle requests to set the value of the "Brightness" characteristic
   */
  HueSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set Hue: %s', this.device.model, this.accessory.displayName, value);

    this.Hue = value;

    switch (this.device.model) {
      case 'MSS560':
      case 'MSS570x':
        break;
      default:
        this.pushSaturationChanges();
    }
  }

  /**
   * Handle requests to set the value of the "Saturation" characteristic
   */
  SaturationSet(value: CharacteristicValue) {
    this.platform.log.debug('%s %s - Set Saturation: %s', this.device.model, this.accessory.displayName, value);

    this.Saturation = value;

    switch (this.device.model) {
      case 'MSS560':
      case 'MSS570x':
        break;
      default:
        this.pushSaturationChanges();
    }
  }

}