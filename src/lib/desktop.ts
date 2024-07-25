import { Models } from '@kittycad/lib/dist/types/src'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import { ProjectConfiguration } from 'wasm-lib/kcl/bindings/ProjectConfiguration'
import { Project } from 'wasm-lib/kcl/bindings/Project'
import { FileEntry } from 'wasm-lib/kcl/bindings/FileEntry'
import { ProjectState } from 'wasm-lib/kcl/bindings/ProjectState'
import { ProjectRoute } from 'wasm-lib/kcl/bindings/ProjectRoute'

export {
  readAppSettingsFile,
  writeAppSettingsFile,
  getState,
  setState,
  getUser,
  login,
} from 'lang/wasm'

export async function renameProjectDirectory(
  projectPath: string,
  newName: string
): Promise<string> {
  return window.electron.ipcRenderer.invoke<string>(
    'rename_project_directory',
    { projectPath, newName }
  )
}

// Get the initial default dir for holding all projects.
export async function getInitialDefaultDir(): Promise<string> {
  return window.electron.getInitialDefaultDir()
}

export async function showInFolder(path: string | undefined): Promise<void> {
  if (!path) {
    console.error('path is undefined cannot call desktop showInFolder')
    return
  }
  return window.electron.ipcRenderer.invoke('show_in_folder', { path })
}

export async function initializeProjectDirectory(
  config: Configuration
): Promise<string | undefined> {
  const projectDir = config.settings.project.directory
  try {
    await window.electron.exists(projectDir)
  } catch (e) {
    if (e === 'ENOENT') {
      window.electron.mkdir(projectDir, { recursive: true }, (e) => {
        console.log(e)
      })
    }
  }

  return projectDir
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
  const projectDir = await initializeProjectDirectory(configuration)
  const projects = []
  const entries = await window.electron.readdir(projectDir)
  for (let entry of entries) {
    // Ignore directories
    console.log(entry)
  }
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

export async function parseProjectRoute(
  configuration: Configuration,
  route: string
): Promise<ProjectRoute> {
  return window.electron.ipcRenderer.invoke('parse_project_route', {
    configuration,
    route,
  })
}

export async function readDirRecursive(path: string): Promise<FileEntry[]> {
  return window.electron.ipcRenderer.invoke('read_dir_recursive', { path })
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
