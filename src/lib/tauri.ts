import { invoke } from '@tauri-apps/api/core'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'

// Read the contents of the app settings.
export async function readAppSettingsFile(): Promise<Configuration> {
  const settings = await invoke<Configuration>('read_app_settings_file')

  return settings
}

// Write the contents of the app settings.
export async function writeAppSettingsFile(
  settings: Configuration
): Promise<void> {
  await invoke('write_app_settings_file', { configuration: settings })
}
