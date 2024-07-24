import { Models } from '@kittycad/lib/dist/types/src'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import { ProjectConfiguration } from 'wasm-lib/kcl/bindings/ProjectConfiguration'
import { Project } from 'wasm-lib/kcl/bindings/Project'
import { FileEntry } from 'wasm-lib/kcl/bindings/FileEntry'
import { ProjectState } from 'wasm-lib/kcl/bindings/ProjectState'
import { ProjectRoute } from 'wasm-lib/kcl/bindings/ProjectRoute'
import { isDesktop } from './isDesktop'

// Get the app state from desktop.
export async function getState(): Promise<ProjectState | undefined> {
  if (!isDesktop()) {
    return undefined
  }
  return await window.electron.ipcRenderer.invoke('get_state')
}

// Set the app state in desktop.
export async function setState(state: ProjectState | undefined): Promise<void> {
  if (!isDesktop()) {
    return
  }
  return window.electron.ipcRenderer.invoke('set_state', { state })
}

export async function renameProjectDirectory(
  projectPath: string,
  newName: string
): Promise<string> {
  return window.electron.ipcRenderer.invoke<string>('rename_project_directory', { projectPath, newName })
}

// Get the initial default dir for holding all projects.
export async function getInitialDefaultDir(): Promise<string> {
  if (!isDesktop()) {
    return ''
  }
  return invoke<string>('get_initial_default_dir')
}

export async function showInFolder(path: string | undefined): Promise<void> {
  if (!isDesktop()) {
    return
  }
  if (!path) {
    console.error('path is undefined cannot call desktop showInFolder')
    return
  }
  return window.electron.ipcRenderer.invoke('show_in_folder', { path })
}

export async function initializeProjectDirectory(
  settings: Configuration
): Promise<string | undefined> {
  if (!isDesktop()) {
    return undefined
  }
  return window.electron.ipcRenderer.invoke('initialize_project_directory', {
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
  return window.electron.ipcRenderer.invoke('create_new_project_directory', {
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
  return window.electron.ipcRenderer.invoke('list_projects', { configuration })
}

export async function getProjectInfo(
  projectPath: string,
  configuration?: Configuration
): Promise<Project> {
  if (!configuration) {
    configuration = await readAppSettingsFile()
  }
  return window.electron.ipcRenderer.invoke('get_project_info', {
    configuration,
    projectPath,
  })
}

export async function login(host: string): Promise<string> {
  return window.electron.ipcRenderer.invoke('login', { host })
}

export async function parseProjectRoute(
  configuration: Configuration,
  route: string
): Promise<ProjectRoute> {
  return window.electron.ipcRenderer.invoke('parse_project_route', {
    configuration,
    route,
  })
}

export async function getUser(
  token: string | undefined,
  host: string
): Promise<Models['User_type'] | Record<'error_code', unknown> | void> {
  if (!token) {
    console.error('token is undefined cannot call desktop getUser')
    return
  }

  return window.electron.ipcRenderer.invoke>(
    'get_user',
    {
      token: token,
      hostname: host,
    }
  ).catch((err) => console.error('error from Tauri getUser', err))
}

export async function readDirRecursive(path: string): Promise<FileEntry[]> {
  return window.electron.ipcRenderer.invoke('read_dir_recursive', { path })
}

// Read the contents of the app settings.
export async function readAppSettingsFile(): Promise<Configuration> {
  return window.electron.ipcRenderer.invoke('read_app_settings_file')
}

// Write the contents of the app settings.
export async function writeAppSettingsFile(
  settings: Configuration
): Promise<void> {
  return window.electron.ipcRenderer.invoke('write_app_settings_file', { configuration: settings })
}

// Read project settings file.
export async function readProjectSettingsFile(
  projectPath: string
): Promise<ProjectConfiguration> {
  return window.electron.ipcRenderer.invoke('read_project_settings_file', {
    projectPath,
  })
}

// Write project settings file.
export async function writeProjectSettingsFile(
  projectPath: string,
  settings: ProjectConfiguration
): Promise<void> {
  return window.electron.ipcRenderer.invoke('write_project_settings_file', {
    projectPath,
    configuration: settings,
  })
}
