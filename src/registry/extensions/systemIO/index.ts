import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import { getProjectInfo } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import { settingsService } from '@src/registry/contracts/settings'
import {
  type ProjectHandle,
  type ProjectHandles,
  type Projects,
  type SystemIOService,
  projectHandlesValueSpec,
  projectsValueSpec,
  systemIOService,
} from '@src/registry/contracts/systemIO'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'

const PROJECT_HANDLES_WATCHER_KEY = 'system-io.project-handles'

type ProjectHandleWithModified = ProjectHandle & {
  modified: number
}

const getElectron = () =>
  typeof window === 'undefined' ? undefined : window.electron

export async function listProjectHandlesFromProjectDirectory(
  projectDirectoryPath: string
): Promise<readonly ProjectHandle[]> {
  if (!projectDirectoryPath) {
    return []
  }

  let entries: string[]
  try {
    entries = await fsZds.readdir(projectDirectoryPath)
  } catch {
    return []
  }

  const handles: ProjectHandleWithModified[] = []

  for (const entry of entries) {
    if (entry.startsWith('.')) {
      continue
    }

    const path = fsZds.join(projectDirectoryPath, entry)

    try {
      const stat = await fsZds.stat(path)
      if (!(stat.mode & fsZdsConstants.S_IFDIR)) {
        continue
      }

      handles.push({ path, modified: stat.mtimeMs })
    } catch {
      // Ignore entries that disappear or cannot be statted.
    }
  }

  return handles
    .sort((a, b) => b.modified - a.modified)
    .map(({ path }) => ({ path }))
}

export const systemIOExtension = defineRegistryItemFactory((ctx) => {
  const projectDirectoryProjectHandles = signal<ProjectHandles>(undefined)
  const projectHandles = ctx.valueSpecs.signal(projectHandlesValueSpec)
  const projects = ctx.valueSpecs.signal(projectsValueSpec)
  let latestProjectDirectoryPath = ''
  let disposed = false
  let disposeSettingsEffect: (() => void) | undefined
  let watchedProjectDirectoryPath = ''

  const getProjectDirectoryPath = () =>
    ctx.services.optional(settingsService)?.current.value.app.projectDirectory
      .current ?? ''

  const refreshProjectHandlesFromDirectory = async (
    projectDirectoryPath: string
  ) => {
    const directoryChanged = projectDirectoryPath !== latestProjectDirectoryPath
    latestProjectDirectoryPath = projectDirectoryPath
    if (directoryChanged) {
      projectDirectoryProjectHandles.value = undefined
    }

    const nextProjectHandles =
      await listProjectHandlesFromProjectDirectory(projectDirectoryPath)

    if (!disposed && projectDirectoryPath === latestProjectDirectoryPath) {
      projectDirectoryProjectHandles.value = nextProjectHandles
    }

    return nextProjectHandles
  }

  const refreshProjectHandles: SystemIOService['refreshProjectHandles'] =
    () => {
      return refreshProjectHandlesFromDirectory(getProjectDirectoryPath())
    }

  const unwatchProjectDirectory = () => {
    const electron = getElectron()
    if (!watchedProjectDirectoryPath || !electron) {
      watchedProjectDirectoryPath = ''
      return
    }

    electron.watchFileOff(
      watchedProjectDirectoryPath,
      PROJECT_HANDLES_WATCHER_KEY
    )
    watchedProjectDirectoryPath = ''
  }

  const watchProjectDirectory = (projectDirectoryPath: string) => {
    if (watchedProjectDirectoryPath === projectDirectoryPath) {
      return
    }

    unwatchProjectDirectory()

    const electron = getElectron()
    if (!projectDirectoryPath || !electron) {
      return
    }

    electron.watchFileOn(
      projectDirectoryPath,
      PROJECT_HANDLES_WATCHER_KEY,
      () => {
        if (projectDirectoryPath !== getProjectDirectoryPath()) {
          return
        }

        void refreshProjectHandlesFromDirectory(projectDirectoryPath)
      }
    )
    watchedProjectDirectoryPath = projectDirectoryPath
  }

  const activate = () => {
    disposeSettingsEffect = effect(() => {
      const projectDirectoryPath = getProjectDirectoryPath()
      watchProjectDirectory(projectDirectoryPath)
      void refreshProjectHandlesFromDirectory(projectDirectoryPath)
    })
  }

  const serviceImpl: SystemIOService = {
    projectHandles,
    projects,
    refreshProjectHandles,
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'system-io-extension',
      provides: [
        provide(projectHandlesValueSpec, projectDirectoryProjectHandles, {
          key: 'system-io.project-directory',
        }),
      ],
      providesServices: [provideService(systemIOService, serviceImpl)],
      activate,
      dispose: () => {
        disposed = true
        disposeSettingsEffect?.()
        unwatchProjectDirectory()
      },
    }),
  }
}, 'system-io-extension')

export const systemIOProjectsExtension = defineRegistryItemFactory((ctx) => {
  const projectHandles = ctx.valueSpecs.signal(projectHandlesValueSpec)
  const projects = signal<Projects>(undefined)
  let latestRefreshId = 0
  let disposed = false
  let disposeProjectHandlesEffect: (() => void) | undefined

  const getWasmPromise = () => ctx.valueSpecs.get(wasmPromiseValueSpec)

  const refreshProjectsFromHandles = async (handles: ProjectHandles) => {
    const refreshId = ++latestRefreshId

    if (handles === undefined) {
      projects.value = undefined
      return
    }

    if (handles.length === 0) {
      projects.value = []
      return
    }

    const wasmPromise = getWasmPromise()
    if (!wasmPromise) {
      projects.value = []
      return
    }

    const wasmInstance = await wasmPromise
    const nextProjects: NonNullable<Projects> = []

    for (const handle of handles) {
      try {
        const project = await getProjectInfo(handle.path, wasmInstance)
        if (project.kcl_file_count === 0 && project.readWriteAccess) {
          continue
        }

        nextProjects.push(project)
      } catch {
        // Ignore handles that no longer point at readable projects.
      }
    }

    if (!disposed && refreshId === latestRefreshId) {
      projects.value = nextProjects
    }
  }

  const activate = () => {
    disposeProjectHandlesEffect = effect(() => {
      void refreshProjectsFromHandles(projectHandles.value)
    })
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'system-io-projects-extension',
      provides: [
        provide(projectsValueSpec, projects, {
          key: 'system-io.project-handles',
        }),
      ],
      activate,
      dispose: () => {
        disposed = true
        disposeProjectHandlesEffect?.()
      },
    }),
  }
}, 'system-io-projects-extension')

const systemIORegistryItem = defineRegistryItem({
  id: 'systemIO',
  uses: [systemIOExtension, systemIOProjectsExtension],
})

export default systemIORegistryItem
