/* eslint-disable @typescript-eslint/no-unused-vars */
import { Service, PlatformAccessory, Characteristic, CharacteristicEventTypes } from 'homebridge';
import { MerossCloudPlatform } from '../platform';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';
import MerossCloud, { MerossCloudDevice } from 'meross-cloud';
import { eventNames, on } from 'process';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class mss620 {
  private service!: Service;

  firstOn;
  secondOn;
  doSmartPlugUpdate: any;
  OutletInUse;
  OutletUpdateInProgress: any;
  OutletUpdate: any;
  meross: any;
  channel: any;

  constructor(
    private readonly platform: MerossCloudPlatform,
    private accessory: PlatformAccessory,
    public device,
    public deviceId,
    public deviceDef,
  ) {
    // default placeholders
    this.firstOn = 0;
    this.secondOn = 0;
    this.OutletInUse;

    // this is subject we use to track when we need to POST changes to the SwitchBot API
    this.OutletUpdate = new Subject();
    this.OutletUpdateInProgress = false;

    // Retrieve initial values and updateHomekit
    this.refreshStatus();

    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Meross')
      .setCharacteristic(this.platform.Characteristic.Model, this.deviceDef.deviceType)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.deviceDef.uuid)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.deviceDef.fmwareVersion);
    for (const channels of deviceDef.channels) {
      // get the LightBulb service if it exists, otherwise create a new Outlet service
      // you can create multiple services for each accessory
      // {"type":"Switch","devName":"Nursery Lamps","devIconId":"device001"}
      if (channels.devName) {
        this.platform.log.debug('Setting Up %s ', channels.devName, JSON.stringify(channels));
        (this.service = this.accessory.getService(channels.devName) || this.accessory.addService(this.platform.Service.Outlet, channels.devName, channels.devName)),
          `${this.deviceDef.devName} ${this.deviceDef.deviceType}`;

        // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
        // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
        // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Outlet, 'NAME', 'USER_DEFINED_SUBTYPE');

        // set the service name, this is what is displayed as the default name on the Home app
        // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.


        this.service.setCharacteristic(this.platform.Characteristic.Name, `${channels.devName} ${this.deviceDef.deviceType}`);

        // each service must implement at-minimum the "required characteristics" for the given service type
        // see https://developers.homebridge.io/#/service/Outlet

        // create handlers for required characteristics
        this.service
          .getCharacteristic(this.platform.Characteristic.On)
          .on(CharacteristicEventTypes.GET, this.handleOn1stGet.bind(this))
          .on(CharacteristicEventTypes.SET, this.handleOn1stSet.bind(this));
      }
    }

    this.service.getCharacteristic(this.platform.Characteristic.OutletInUse).on('get', this.handleOutletInUseGet.bind(this));

    // Retrieve initial values and updateHomekit
    //this.refreshStatus();
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
        this.platform.log.error('ERROR: ',JSON.stringify(e.message));
        this.platform.log.debug('ERROR: %s %s -', this.deviceDef.deviceType, this.accessory.displayName, JSON.stringify(e));
      }
      this.OutletUpdateInProgress = false;
    });
  }

  /**
   * Parse the device status from the SwitchBot api
   */
  parseStatus() {
    this.firstOn = 0;
    this.secondOn = 0;
    this.OutletInUse = 0;
  }

  /**
   * Asks the SwitchBot API for the latest device information
   */
  async refreshStatus() {
    this.device.on('data', (namespace, payload) => {
      this.platform.log.info('DEV: ' + this.deviceId + ' ' + namespace + ' - data: ' + JSON.stringify(payload));
    });
    for (const channels of this.deviceDef.channels) {
      this.channel = channels;
    }

    try {
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e) {
      this.platform.log.error(
        'ERROR: %s - Failed to update status of %s',
        this.deviceDef.deviceType,
        this.deviceDef.devName,
        JSON.stringify(e.message),
        this.platform.log.debug('ERROR %s %s -', this.deviceDef.deviceType, this.accessory.displayName, JSON.stringify(e)),
      );
    }
  }

  /**
   * Pushes the requested changes to the SwitchBot API
   */
  async pushChanges() {
    //this.device.controlToggleX(val.channel, (value ? 1 : 0), (err, res) => {
    //   this.platform.log.debug('ToggleX Response: err: ' + err + ', res: ' + JSON.stringify(res));
    //   this.platform.log.debug(this.deviceId + '.' + val.channel + ': set value ' + value);
    // });
    //this.platform.log.debug('Outlet %s pushChanges -', this.accessory.displayName);

    // Make the API request
    this.platform.log.debug('Outlet %s Changes pushed -', this.accessory.displayName);
    await this.refreshStatus();
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.firstOn);
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.secondOn);
    this.service.updateCharacteristic(this.platform.Characteristic.OutletInUse, this.OutletInUse);
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  handleOn1stGet(callback) {
    this.platform.log.debug('Triggered GET On');

    // set this to a valid value for On
    const currentValue = this.firstOn;

    callback(null, currentValue);
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  handleOn1stSet(value, callback) {
    this.platform.log.debug('Triggered SET On:', value);

    callback(null);
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  handleOn2ndGet(callback) {
    this.platform.log.debug('Triggered GET On');

    // set this to a valid value for On
    const currentValue = 1;

    callback(null, currentValue);
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  handleOn2ndSet(value, callback) {
    this.platform.log.debug('Triggered SET On:', value);

    callback(null);
  }

  /**
   * Handle requests to get the current value of the "Outlet In Use" characteristic
   */
  handleOutletInUseGet(callback) {
    this.platform.log.debug('Triggered GET OutletInUse');

    // set this to a valid value for OutletInUse
    const currentValue = this.secondOn;

    callback(null, currentValue);
  }
}
