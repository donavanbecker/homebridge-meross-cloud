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

  On!: CharacteristicValue;
  OutletInUse: CharacteristicValue;
  OutletUpdateInProgress: any;
  OutletUpdate: Subject<unknown>;
  devicestatus!: Record<any, any>;
  channel!: number;
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
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, '4.1.29');

    for (const channels of deviceDef.channels) {
      if (channels.devName) {
        this.platform.log.debug('Setting Up %s ', channels.devName, JSON.stringify(channels));
        (this.service = this.accessory.getService(channels.devName)
          || this.accessory.addService(this.platform.Service.Outlet, channels.devName, channels.devName)), accessory.displayName;
        this.service.setCharacteristic(this.platform.Characteristic.Name, `${channels.devName} ${deviceDef.deviceType}`);

        // each service must implement at-minimum the "required characteristics" for the given service type
        // see https://developers.homebridge.io/#/service/Outlet
        this.service
          .getCharacteristic(this.platform.Characteristic.On)
          .onSet(this.OnSet.bind(this));

        this.service.setCharacteristic(this.platform.Characteristic.OutletInUse, true);
      }
    }


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
    for (const channel of this.devicestatus.all.digest.togglex) {
      this.channel = channel.channel;

      setTimeout(() => {
        this.platform.log.info('Toggle %s, Channel: %s to %s', this.accessory.displayName, this.channel, this.On);
        this.device.controlToggleX(this.channel, Boolean(this.On), async (err, res) => {
          this.platform.log.debug('Toggle Response: err: ' + err + ', res: ' + JSON.stringify(res.all));
          await this.refreshStatus();
        });
      }, 2000);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    this.platform.log.debug('Update: %s', this.channel);
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.On);
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  private OnSet(value: CharacteristicValue) {
    this.platform.log.debug('%s Triggered SET On:', this.deviceDef.devName, this.channel, value);

    this.On = value;
    this.pushChanges();
  }
}
