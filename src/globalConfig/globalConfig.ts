/**
 * Functions for manipulating the global configuration file, which lives at
 * ~/.promptfoo/promptfoo.yaml by default.
 */
import * as fs from 'fs';
import * as path from 'path';

import yaml from 'js-yaml';
import { getConfigDirectoryPath } from '../util/config/manage';

import type { GlobalConfig } from '../configTypes';

const GLOBAL_CONFIG_DIR_MODE = 0o700;
const GLOBAL_CONFIG_FILE_MODE = 0o600;

function chmodBestEffort(filePath: string, mode: number): void {
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // Permission hardening should not make config reads/writes fail.
  }
}

function writeGlobalConfigFile(configFilePath: string, config: GlobalConfig): void {
  fs.writeFileSync(configFilePath, yaml.dump(config), { mode: GLOBAL_CONFIG_FILE_MODE });
  chmodBestEffort(configFilePath, GLOBAL_CONFIG_FILE_MODE);
}

export function writeGlobalConfig(config: GlobalConfig): void {
  const configDir = getConfigDirectoryPath(true) /* createIfNotExists */;
  chmodBestEffort(configDir, GLOBAL_CONFIG_DIR_MODE);
  writeGlobalConfigFile(path.join(configDir, 'promptfoo.yaml'), config);
}

export function readGlobalConfig(): GlobalConfig {
  const configDir = getConfigDirectoryPath();
  const configFilePath = path.join(configDir, 'promptfoo.yaml');
  let globalConfig: GlobalConfig = { id: crypto.randomUUID() };
  if (fs.existsSync(configFilePath)) {
    chmodBestEffort(configDir, GLOBAL_CONFIG_DIR_MODE);
    chmodBestEffort(configFilePath, GLOBAL_CONFIG_FILE_MODE);
    globalConfig = (yaml.load(fs.readFileSync(configFilePath, 'utf-8')) as GlobalConfig) || {};
    if (!globalConfig?.id) {
      globalConfig = { ...globalConfig, id: crypto.randomUUID() };
      writeGlobalConfig(globalConfig);
    }
  } else {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: GLOBAL_CONFIG_DIR_MODE });
    }
    chmodBestEffort(configDir, GLOBAL_CONFIG_DIR_MODE);
    writeGlobalConfigFile(configFilePath, globalConfig);
  }

  return globalConfig;
}

/**
 * Merges the top-level keys into existing config.
 * @param partialConfig New keys to merge into the existing config.
 */
export function writeGlobalConfigPartial(partialConfig: Partial<GlobalConfig>): void {
  const currentConfig = readGlobalConfig();
  // Create a shallow copy of the current config
  const updatedConfig: GlobalConfig = { ...currentConfig };

  // Use Object.entries for better type safety
  Object.entries(partialConfig).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      // Type assertion: we know key is valid from partialConfig, and value matches the key's type
      (updatedConfig as Record<string, unknown>)[key] = value;
    } else {
      // Remove the property if value is falsy
      delete (updatedConfig as Record<string, unknown>)[key];
    }
  });

  writeGlobalConfig(updatedConfig);
}
