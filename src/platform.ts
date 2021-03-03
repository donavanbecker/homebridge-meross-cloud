import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME, MerossCloudPlatformConfig } from './settings';
import MerossCloud, { DeviceDefinition, MerossCloudDevice } from 'meross-cloud';
import { mss110 } from './Devices/mss110';
import { mss620 } from './devices/mss620';
import { hp110a } from './devices/hp110a';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class MerossCloudPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  constructor(public readonly log: Logger, public readonly config: MerossCloudPlatformConfig, public readonly api: API) {
    this.log.debug('Finished initializing platform:', this.config.name);
    // only load if configured
    if (!this.config) {
      return;
    }

    // HOOBS notice
    if (__dirname.includes('hoobs')) {
      this.log.warn('This plugin has not been tested under HOOBS, it is highly recommended that ' +
        'you switch to Homebridge: https://git.io/Jtxb0');
    }

    // verify the config
    try {
      this.verifyConfig();
      this.log.debug('Config OK');
    } catch (e) {
      this.log.error(JSON.stringify(e.message));
      this.log.debug(JSON.stringify(e));
      return;
    }

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      try {
        this.discoverDevices();
      } catch (e) {
        this.log.error('Failed to Discover Devices.', JSON.stringify(e.message));
        this.log.debug(JSON.stringify(e));
      }
    });

    api.on('shutdown', async () => {
      log.warn('Homebridge is shutting down, Disconnecting Meross Cloud');
      // run the method to discover / register your devices as accessories
      try {
        this.homebridgeShutdown();
      } catch (e) {
        this.log.error('Unable to lg off of meross.', JSON.stringify(e.message));
        this.log.debug(JSON.stringify(e));
      }
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Verify the config passed to the plugin is valid
   */
  verifyConfig() {
    /**
     * Hidden Device Discovery Option
     * This will disable adding any device and will just output info.
     */
    this.config.devicediscovery;
    this.config!.email!;
    this.config!.password!;

    // Hide Devices by DeviceID
    this.config.hide_device = this.config.hide_device || [];

    if (this.config.refreshRate! < 30) {
      throw new Error('Refresh Rate must be above 30 (30 seconds).');
    }

    if (!this.config.refreshRate) {
      this.config.refreshRate! = 300;
      this.log.warn('Using Default Refresh Rate.');
    }
  }

  public login() {
    const options: any = {
      'email': this.config.email,
      'password': this.config.password,
    };
    const meross = new MerossCloud(options);
    return meross;
  }

  homebridgeShutdown() {
    const meross = this.login();

    meross.on('deviceInitialized', (deviceId, deviceDef, device) => {
      this.log.debug('New device ' + deviceId + ': ' + JSON.stringify(deviceDef));
      device.disconnect(true);
    });
  }

  discoverDevices() {
    const meross = this.login();

    meross.on('deviceInitialized', (deviceId, deviceDef, device) => {
      this.log.debug('New device ' + deviceId + ': ' + JSON.stringify(deviceDef));
      device.on('connected', () => {
        this.deviceInfo(device);
        switch (deviceDef.deviceType) {
          case 'mss110':
          case 'mss210':
          case 'mss310':
          case 'mss310r':
            if (this.config.devicediscovery) {
              this.log.info('Discovered %s %s', deviceDef.devName, deviceDef.deviceType, deviceDef.uuid);
            }
            this.createMSS110(deviceDef, device, deviceId);
            break;
          case 'hp110a':
            if (this.config.devicediscovery) {
              this.log.info('Discovered %s %s', deviceDef.devName, deviceDef.deviceType, deviceDef.uuid);
            }
            this.createHP110A(deviceDef, device, deviceId);
            break;
          case '/mss620':
            if (this.config.devicediscovery) {
              this.log.info('Discovered %s %s', deviceDef.devName, deviceDef.deviceType, deviceDef.uuid);
            }
            this.createMSS620(deviceDef, device, deviceId);
            break;
          default:
            this.log.info(
              'Device Type: %s, is currently not supported.',
              deviceDef.deviceType,
              'Submit Feature Requests Here: https://git.io/JtfVC',
            );
        }
      });

    });

    meross.connect((error) => {
      if (error !== null) {
        switch (error.message) {
          case '1006':
            this.log.error('Bad Password Format.');
            break;
          case '1003':
            this.log.error('This account has been disabled or deleted.');
            break;
          case '1005':
            this.log.error('Invalid email address.');
            break;
          case '1001':
            this.log.error('Wrong or missing password.');
            break;
          case '0':
            this.log.error('Not an error.');
            break;
          case '1200':
            this.log.error('Token has expired.');
            break;
          case '1019':
            this.log.error('Token expired.');
            break;
          case '1301':
            this.log.error('Too many tokens have been issued.');
            break;
          case '1002':
            this.log.error('Account does not exist.');
            break;
          case '1004':
            this.log.error('Wrong email or password.');
            break;
          case '1008':
            this.log.error('This eamil is not registered.');
            break;
          default:
            this.log.error('Unable to Connect to Meross Cloud.', error);
        }
      }
    });
  }

  private async createMSS110(deviceDef: DeviceDefinition, device: MerossCloudDevice, deviceId: string) {
    this.log.debug(`${deviceDef.deviceType} UDID: ${deviceDef.devName}-${deviceDef.uuid}-${deviceDef.deviceType}`);
    const uuid = this.api.hap.uuid.generate(`${deviceDef.devName}-${deviceDef.uuid}-${deviceDef.deviceType}`);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (deviceDef.onlineStatus === 1 && !this.config.hide_device?.includes(deviceId)) {
        this.log.info('Restoring existing accessory from cache: %s %s Device ID: %s', deviceDef.devName, deviceDef.deviceType, deviceId);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new mss110(this, existingAccessory, device, deviceId, deviceDef);
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (deviceDef.onlineStatus === 1 && !this.config.hide_device?.includes(deviceId)) {
      // the accessory does not yet exist, so we need to create it
      this.log.debug(`${deviceDef.deviceType} UDID: ${deviceDef.devName}-${deviceDef.uuid}-${deviceDef.deviceType}`);
      this.log.info('Adding new accessory: %s %s Device ID: %s', deviceDef.devName, deviceDef.deviceType, deviceId);

      // create a new accessory
      const accessory = new this.api.platformAccessory(`${deviceDef.devName} ${deviceDef.deviceType}`, uuid);

      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new mss110(this, accessory, device, deviceId, deviceDef);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    } else {
      if (!this.config.hide_device?.includes(deviceId)) {
        this.log.error(
          'Unable to Register new device: %s %s - %s',
          deviceDef.devName,
          deviceDef.deviceType,
          deviceDef.uuid,
        );
      }
    }
  }

  private async createHP110A(deviceDef: DeviceDefinition, device: MerossCloudDevice, deviceId: string) {
    this.log.debug(`${deviceDef.deviceType} UDID: ${deviceDef.devName}-${deviceDef.uuid}-${deviceDef.deviceType}`);
    const uuid = this.api.hap.uuid.generate(`${deviceDef.devName}-${deviceDef.uuid}-${deviceDef.deviceType}`);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (deviceDef.onlineStatus === 1 && !this.config.hide_device?.includes(deviceId)) {
        this.log.info('Restoring existing accessory from cache: %s %s Device ID: %s', deviceDef.devName, deviceDef.deviceType, deviceId);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new hp110a(this, existingAccessory, device, deviceId, deviceDef);
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (deviceDef.onlineStatus === 1 && !this.config.hide_device?.includes(deviceId)) {
      // the accessory does not yet exist, so we need to create it
      this.log.debug(`${deviceDef.deviceType} UDID: ${deviceDef.devName}-${deviceDef.uuid}-${deviceDef.deviceType}`);
      this.log.info('Adding new accessory: %s %s Device ID: %s', deviceDef.devName, deviceDef.deviceType, deviceId);

      // create a new accessory
      const accessory = new this.api.platformAccessory(`${deviceDef.devName} ${deviceDef.deviceType}`, uuid);

      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new hp110a(this, accessory, device, deviceId, deviceDef);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    } else {
      if (!this.config.hide_device?.includes(deviceId)) {
        this.log.error(
          'Unable to Register new device: %s %s - %s',
          deviceDef.devName,
          deviceDef.deviceType,
          deviceDef.uuid,
        );
      }
    }
  }

  private async createMSS620(deviceDef: DeviceDefinition, device: MerossCloudDevice, deviceId: string) {
    this.log.debug(`${deviceDef.deviceType} UDID: ${deviceDef.devName}-${deviceDef.uuid}-${deviceDef.deviceType}`);
    const uuid = this.api.hap.uuid.generate(`${deviceDef.devName}-${deviceDef.uuid}-${deviceDef.deviceType}`);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (deviceDef.onlineStatus === 1 && !this.config.hide_device?.includes(deviceId)) {
        this.log.info('Restoring existing accessory from cache: %s %s Device ID: %s', deviceDef.devName, deviceDef.deviceType, deviceId);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new mss620(this, existingAccessory, device, deviceId, deviceDef);
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (deviceDef.onlineStatus === 1 && !this.config.hide_device?.includes(deviceId)) {
      // the accessory does not yet exist, so we need to create it
      this.log.debug(`${deviceDef.deviceType} UDID: ${deviceDef.devName}-${deviceDef.uuid}-${deviceDef.deviceType}`);
      this.log.info('Adding new accessory: %s %s Device ID: %s', deviceDef.devName, deviceDef.deviceType, deviceId);

      // create a new accessory
      const accessory = new this.api.platformAccessory(`${deviceDef.devName} ${deviceDef.deviceType}`, uuid);

      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new mss620(this, accessory, device, deviceId, deviceDef);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    } else {
      if (!this.config.hide_device?.includes(deviceId)) {
        this.log.error(
          'Unable to Register new device: %s %s - %s',
          deviceDef.devName,
          deviceDef.deviceType,
          deviceDef.uuid,
        );
      }
    }
  }

  public unregisterPlatformAccessories(existingAccessory: PlatformAccessory) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
  }

  public deviceInfo(device: MerossCloudDevice) {
    if (this.config.devicediscovery) {
      device.getSystemAllData((error, results) => {
        this.log.info('All-Data: ' + JSON.stringify(results));
        if (error) {
          this.log.error('Error: ' + JSON.stringify(error));
        }
      });
      device.getSystemAbilities((error, results) => {
        this.log.info('System-Abilities: ' + JSON.stringify(results));
        if (error) {
          this.log.error('Error: ' + JSON.stringify(error));
        }
      });
    }
  }
}
