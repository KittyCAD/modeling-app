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

// Read project settings file.
export async function readProjectSettingsFile(
  appSettings: Configuration,
  projectName: string
): Promise<Configuration> {
  const settings = await invoke<Configuration>('read_project_settings_file', {
    app_settings: appSettings,
    project_name: projectName,
  })

  return settings
}

// Write project settings file.
export async function writeProjectSettingsFile(
  appSettings: Configuration,
  projectName: string,
  settings: Configuration
): Promise<void> {
  await invoke('write_project_settings_file', {
    app_settings: appSettings,
    project_name: projectName,
    configuration: settings,
  })
}
