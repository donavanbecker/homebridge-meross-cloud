/* eslint-disable @typescript-eslint/no-unused-vars */
import { Service, PlatformAccessory, Characteristic, CharacteristicEventTypes, CharacteristicValue } from 'homebridge';
import { MerossCloudPlatform } from '../platform';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';
import MerossCloud, { DeviceDefinition, MerossCloudDevice } from 'meross-cloud';
import { eventNames, on } from 'process';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class mss620 {
  private service!: Service;

  doSmartPlugUpdate: any;
  OutletInUse;
  OutletUpdateInProgress: any;
  OutletUpdate: any;
  meross: any;
  channel: any;
  On!: CharacteristicValue;
  onoff!: number;
  devicestatus: any;

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
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision).updateValue(accessory.context.firmwareRevision || '4.1.29');

    for (const channels of deviceDef.channels) {
      // get the LightBulb service if it exists, otherwise create a new Outlet service
      // you can create multiple services for each accessory
      // {"type":"Switch","devName":"Nursery Lamps","devIconId":"device001"}
      if (channels.devName) {
        this.platform.log.debug('Setting Up %s ', channels.devName, JSON.stringify(channels));
        (this.service = this.accessory.getService(channels.devName)
          || this.accessory.addService(this.platform.Service.Outlet, channels.devName, channels.devName)),
        `${deviceDef.devName} ${deviceDef.deviceType}`;

        // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
        // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
        // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Outlet, 'NAME', 'USER_DEFINED_SUBTYPE');

        // set the service name, this is what is displayed as the default name on the Home app
        // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.


        this.service.setCharacteristic(this.platform.Characteristic.Name, `${channels.devName} ${deviceDef.deviceType}`);

        // each service must implement at-minimum the "required characteristics" for the given service type
        // see https://developers.homebridge.io/#/service/Outlet

        // create handlers for required characteristics
        this.service
          .getCharacteristic(this.platform.Characteristic.On)
          .onGet(async () => {
            return this.On;
          })
          .onSet(async (value: CharacteristicValue) => {
            this.OnSet(value);
          });
      }
    }

    this.service.getCharacteristic(this.platform.Characteristic.OutletInUse).onGet(async () => {
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
    if (this.channel.onoff === 1) {
      this.On === true;
    } else {
      this.On === false;
    }
    this.OutletInUse === true;
  }

  /**
   * Asks the SwitchBot API for the latest device information
   */
  async refreshStatus() {
    if (this.deviceDef.channels) {
      for (const channels of this.deviceDef.channels) {
        if (channels.devName) {
          this.device.on('data', (namespace: string, payload: any) => {
            this.platform.log.debug('DEV: ' + this.deviceId + ' ' + namespace + ' - data: ' + JSON.stringify(payload));
            this.devicestatus = payload;
            for (const channel of this.devicestatus.togglex) {
              this.channel = channel.channel;
            }
            try {
              this.parseStatus();
              this.updateHomeKitCharacteristics();
            } catch (e) {
              this.platform.log.error(
                '%s: %s - Failed to update status of %s',
                this.deviceDef.devName,
                this.deviceDef.deviceType,
                this.deviceDef.devName,
                JSON.stringify(e.message),
                this.platform.log.debug(
                  '%s: %s %s -',
                  this.deviceDef.devName,
                  this.deviceDef.deviceType,
                  this.accessory.displayName,
                  JSON.stringify(e)),
              );
            }
          });
        }
      }
    } else if (!this.deviceDef.channels) {
      this.platform.log.debug('%s Invalid Channel', this.deviceDef.channels);
    }
  }

  /**
   * Pushes the requested changes to the SwitchBot API
   */
  async pushChanges() {
    for (const channel of this.devicestatus.togglex) {
      this.channel = channel.channel;
    
      if (this.On && this.channel !== 0) {
        this.device.controlToggleX(this.channel, true, (err, res) => {
          this.platform.log.debug('ToggleX Response: err: ' + err + ', res: ' + JSON.stringify(res));
          this.platform.log.info(this.deviceId + '.' + this.channel + ': set value ' + this.On);
        });
      } else if (!this.On && this.channel !== 0) {
        this.device.controlToggleX(this.channel, false, (err, res) => {
          this.platform.log.debug('ToggleX Response: err: ' + err + ', res: ' + JSON.stringify(res));
          this.platform.log.info(this.deviceId + '.' + this.channel + ': set value ' + this.On);
        });
      }
      // Make the API request
      this.platform.log.debug('Outlet %s Changes pushed -', this.accessory.displayName);
      await this.refreshStatus();
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    for (const channels of this.deviceDef.channels) {
      if (channels.devName) {
        this.platform.log.warn('Update: %s', channels);
        this.service.updateCharacteristic(this.platform.Characteristic.On, this.On);
      }
    }
    this.service.updateCharacteristic(this.platform.Characteristic.OutletInUse, this.OutletInUse);
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  private OnSet(value: CharacteristicValue) {
    this.platform.log.debug('%s Triggered SET On:', this.deviceDef.devName, value);

    this.On = value;
    this.pushChanges();
  }
}
