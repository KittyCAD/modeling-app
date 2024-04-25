// This file contains wrappers around the tauri commands we define in rust code.

import { Models } from '@kittycad/lib/dist/types/src'
import { invoke } from '@tauri-apps/api/core'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import { ProjectConfiguration } from 'wasm-lib/kcl/bindings/ProjectConfiguration'
import { Project } from 'wasm-lib/kcl/bindings/Project'
import { FileEntry } from 'wasm-lib/kcl/bindings/FileEntry'
import { ProjectState } from 'wasm-lib/kcl/bindings/ProjectState'

// Get the app state from tauri.
export async function getState(): Promise<ProjectState | undefined> {
  return await invoke<string>('get__state')
}

// Get the initial default dir for holding all projects.
export async function getInitialDefaultDir(): Promise<string> {
  return invoke<string>('get_initial_default_dir')
}

export async function showInFolder(path: string | undefined): Promise<void> {
  if (!path) {
    console.error('path is undefined cannot call tauri showInFolder')
    return
  }
  return await invoke('show_in_folder', { path })
}

export async function initializeProjectDirectory(
  settings: Configuration
): Promise<string> {
  return await invoke<string>('initialize_project_directory', {
    configuration: settings,
  })
}

export async function createNewProjectDirectory(
  projectName: string,
  initialCode?: string,
  configuration?: Configuration
): Promise<Project> {
  if (!configuration) {
    configuration = await readAppSettingsFile()
  }
  return await invoke<Project>('create_new_project_directory', {
    configuration,
    projectName,
    initialCode,
  })
}

export async function listProjects(
  configuration?: Configuration
): Promise<Project[]> {
  if (!configuration) {
    configuration = await readAppSettingsFile()
  }
  return await invoke<Project[]>('list_projects', { configuration })
}

export async function getProjectInfo(
  projectName: string,
  configuration?: Configuration
): Promise<Project> {
  if (!configuration) {
    configuration = await readAppSettingsFile()
  }
  return await invoke<Project>('get_project_info', {
    configuration,
    projectName,
  })
}

export async function login(host: string): Promise<string> {
  return await invoke('login', { host })
}

export async function getUser(
  token: string | undefined,
  host: string
): Promise<Models['User_type'] | Record<'error_code', unknown> | void> {
  if (!token) {
    console.error('token is undefined cannot call tauri getUser')
    return
  }

  return await invoke<Models['User_type'] | Record<'error_code', unknown>>(
    'get_user',
    {
      token: token,
      hostname: host,
    }
  ).catch((err) => console.error('error from Tauri getUser', err))
}

export async function readDirRecursive(path: string): Promise<FileEntry[]> {
  return await invoke<FileEntry[]>('read_dir_recursive', { path })
}

// Read the contents of the app settings.
export async function readAppSettingsFile(): Promise<Configuration> {
  return await invoke<Configuration>('read_app_settings_file')
}

// Write the contents of the app settings.
export async function writeAppSettingsFile(
  settings: Configuration
): Promise<void> {
  return await invoke('write_app_settings_file', { configuration: settings })
}

// Read project settings file.
export async function readProjectSettingsFile(
  appSettings: Configuration,
  projectName: string
): Promise<ProjectConfiguration> {
  return await invoke<ProjectConfiguration>('read_project_settings_file', {
    appSettings,
    projectName,
  })
}

// Write project settings file.
export async function writeProjectSettingsFile(
  appSettings: Configuration,
  projectName: string,
  settings: ProjectConfiguration
): Promise<void> {
  return await invoke('write_project_settings_file', {
    appSettings,
    projectName,
    configuration: settings,
  })
}
