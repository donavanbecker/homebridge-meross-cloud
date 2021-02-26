/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'MerossCloud';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = 'homebridge-meross-cloud';

import { PlatformConfig } from 'homebridge';

//Config
export interface MerossCloudPlatformConfig extends PlatformConfig {
  devicediscovery?: boolean;
  email?: string;
  password?: string;
  refreshRate?: number;
  hide_device?: string[];
}