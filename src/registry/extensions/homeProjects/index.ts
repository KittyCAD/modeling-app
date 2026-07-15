import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, effect, signal } from '@preact/signals-core'
import {
  getProjectInfo,
  writeProjectTitleToProjectToml,
} from '@src/lib/desktop'
import {
  getHomeProjectDisplayName,
  homeProjectEntryFromProject,
} from '@src/lib/homeProjects'
import type { Project } from '@src/lib/project'
import { readProjectsFromProjectDirectory } from '@src/lib/projectDirectoryScanner'
import {
  DEFAULT_PROJECT_LIBRARY_ID,
  type ProjectLibrary,
  projectLibraryFromSetting,
} from '@src/lib/projectLibraries'
import { reportRejection } from '@src/lib/trap'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import {
  type HomeProjectActionsService,
  type HomeProjectEntry,
  type HomeProjectEntryContribution,
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import {
  type ProjectLibraryTypeContribution,
  projectLibrariesValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { settingsService } from '@src/registry/contracts/settings'
import { systemIOService } from '@src/registry/contracts/systemIO'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import toast from 'react-hot-toast'

function localHomeProjectEntriesFromProjects(
  projects: readonly Project[] | undefined,
  libraryId: string
): HomeProjectEntryContribution[] {
  return (
    projects?.map((project) => ({
      ...homeProjectEntryFromProject(project),
      libraryId,
    })) ?? []
  )
}

function homeProjectDisplayNameExists({
  entries,
  requestedName,
  projectId,
}: {
  entries: readonly HomeProjectEntry[] | undefined
  requestedName: string
  projectId: string
}) {
  return Boolean(
    entries?.some(
      (project) =>
        project.id !== projectId &&
        getHomeProjectDisplayName(project) === requestedName
    )
  )
}

const homeProjectActions = defineRegistryItemFactory((ctx) => {
  const systemIO = ctx.services.signal(systemIOService)
  const cloudSync = ctx.services.signal(cloudSyncService)

  const getWasmPromise = () =>
    ctx.valueSpecs.get(wasmPromiseValueSpec) ??
    Promise.reject(new Error('Missing WASM promise registry value.'))

  const serviceImpl: HomeProjectActionsService = {
    canOpen: (project) =>
      Boolean(
        (project.readWriteAccess && project.defaultFile) ||
          project.remoteProjectId
      ),
    canRename: (project) =>
      Boolean(project.localProjectPath && project.readWriteAccess),
    canDelete: (project) =>
      Boolean(project.localProjectName && project.readWriteAccess),
    open: async (project) => {
      if (project.readWriteAccess && project.defaultFile) {
        return { defaultFile: project.defaultFile }
      }

      if (!project.remoteProjectId) {
        return undefined
      }

      const syncedProject = await cloudSync.value?.ensureProjectLocallySynced(
        project.remoteProjectId
      )
      if (!syncedProject) {
        return undefined
      }

      const projectInfo = await getProjectInfo(
        syncedProject.projectPath,
        await getWasmPromise()
      )
      systemIO.value?.actor.send({
        type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
      })
      return { defaultFile: projectInfo.default_file }
    },
    rename: async (project, requestedName) => {
      if (!serviceImpl.canRename(project) || !project.localProjectPath) {
        return
      }

      if (
        homeProjectDisplayNameExists({
          entries: ctx.valueSpecs.get(homeProjectEntriesValueSpec),
          requestedName,
          projectId: project.id,
        })
      ) {
        const message = `Project with name "${requestedName}" already exists`
        toast.error(message)
        return Promise.reject(new Error(message))
      }

      await writeProjectTitleToProjectToml(
        project.localProjectPath,
        requestedName
      )
      toast.success(
        `Successfully renamed "${getHomeProjectDisplayName(project)}" to "${requestedName}"`
      )
      systemIO.value?.actor.send({
        type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
      })
    },
    delete: async (project) => {
      if (!serviceImpl.canDelete(project) || !project.localProjectName) {
        return
      }

      systemIO.value?.actor.send({
        type: SystemIOMachineEvents.deleteProject,
        data: {
          requestedProjectName: project.localProjectName,
        },
      })
    },
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'home-projects.actions',
      providesServices: [
        provideService(homeProjectActionsService, serviceImpl),
      ],
    }),
  }
}, 'home-projects.actions')

const systemIOLocalHomeProjectEntries = defineRegistryItemFactory((ctx) => {
  const entries = signal<HomeProjectEntryContribution[]>([])
  const systemIO = ctx.services.signal(systemIOService)
  let systemIOSubscription: { unsubscribe: () => void } | undefined
  let disposeSystemIOEffect: (() => void) | undefined
  let disposed = false

  queueMicrotask(() => {
    if (disposed) {
      return
    }

    disposeSystemIOEffect = effect(() => {
      const service = systemIO.value
      systemIOSubscription?.unsubscribe()
      systemIOSubscription = undefined
      entries.value = []

      if (!service) {
        return
      }

      const updateEntries = () => {
        entries.value = localHomeProjectEntriesFromProjects(
          service.actor.getSnapshot().context.folders,
          DEFAULT_PROJECT_LIBRARY_ID
        )
      }

      updateEntries()
      systemIOSubscription = service.actor.subscribe(updateEntries)
    })
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'home-projects.system-io-local-projects',
      provides: [
        provide(homeProjectEntriesValueSpec, entries, {
          key: 'home-projects.system-io-local-projects',
        }),
      ],
      dispose: () => {
        disposed = true
        disposeSystemIOEffect?.()
        systemIOSubscription?.unsubscribe()
      },
    }),
  }
}, 'home-projects.system-io-local-projects')

const directoryProjectLibraryType = defineRegistryItemFactory((ctx) => {
  const directoryType: ProjectLibraryTypeContribution = {
    type: 'directory',
    title: 'Directory',
    icon: 'folder',
    readEntries: async ({ library, signal }) => {
      const wasmInstancePromise = ctx.valueSpecs.get(wasmPromiseValueSpec)
      if (!wasmInstancePromise) {
        return Promise.reject(new Error('Missing WASM promise registry value.'))
      }

      const projects = await readProjectsFromProjectDirectory({
        projectDirectoryPath: library.path,
        wasmInstancePromise,
        signal,
      })

      return localHomeProjectEntriesFromProjects(projects, library.id)
    },
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'home-projects.directory-project-library-type',
      provides: [
        provide(projectLibraryTypesValueSpec, directoryType, {
          key: 'home-projects.directory-project-library-type',
        }),
      ],
    }),
  }
}, 'home-projects.directory-project-library-type')

const configuredProjectLibraries = defineRegistryItemFactory((ctx) => {
  const settings = ctx.services.signal(settingsService)
  const libraryTypes = ctx.valueSpecs.signal(projectLibraryTypesValueSpec)
  const libraries = computed<ProjectLibrary[]>(() => {
    const currentSettings = settings.value?.current.value
    if (!currentSettings) {
      return []
    }

    const defaultProjectDirectory = currentSettings.app.projectDirectory.current

    return currentSettings.app.libraries.current.map((library, index) => ({
      ...projectLibraryFromSetting(library, index, {
        defaultProjectDirectory,
      }),
      icon:
        libraryTypes.value.get(library.type)?.icon ??
        (library.type === 'cloud' ? 'network' : 'folder'),
      order: index,
    }))
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'home-projects.configured-project-libraries',
      provides: [
        provide(projectLibrariesValueSpec, libraries, {
          key: 'home-projects.configured-project-libraries',
        }),
      ],
    }),
  }
}, 'home-projects.configured-project-libraries')

const configuredProjectLibraryEntries = defineRegistryItemFactory((ctx) => {
  const settings = ctx.services.signal(settingsService)
  const libraryTypes = ctx.valueSpecs.signal(projectLibraryTypesValueSpec)
  const entries = signal<HomeProjectEntryContribution[]>([])
  const entriesByLibraryId = new Map<string, HomeProjectEntryContribution[]>()
  let abortController: AbortController | undefined
  let disposeConfiguredProjectLibraryEntriesEffect: (() => void) | undefined
  let disposed = false
  let loadId = 0

  const updateEntries = () => {
    entries.value = Array.from(entriesByLibraryId.values()).flat()
  }

  queueMicrotask(() => {
    if (disposed) {
      return
    }

    disposeConfiguredProjectLibraryEntriesEffect = effect(() => {
      const currentSettings = settings.value?.current.value
      const typeById = libraryTypes.value
      const nextLoadId = ++loadId

      abortController?.abort()
      const loadController = new AbortController()
      abortController = loadController
      entriesByLibraryId.clear()
      entries.value = []

      if (!currentSettings) {
        return
      }

      const defaultProjectDirectory =
        currentSettings.app.projectDirectory.current
      const configuredLibraries = currentSettings.app.libraries.current
        .map((library, index) =>
          projectLibraryFromSetting(library, index, {
            defaultProjectDirectory,
          })
        )
        .filter((library) => library.id !== DEFAULT_PROJECT_LIBRARY_ID)

      for (const library of configuredLibraries) {
        const readEntries = typeById.get(library.type)?.readEntries
        if (!readEntries) {
          continue
        }

        readEntries({
          library,
          signal: loadController.signal,
        })
          .then((libraryEntries) => {
            if (
              disposed ||
              loadController.signal.aborted ||
              nextLoadId !== loadId
            ) {
              return
            }

            entriesByLibraryId.set(library.id, libraryEntries)
            updateEntries()
          })
          .catch((error: unknown) => {
            if (
              disposed ||
              loadController.signal.aborted ||
              nextLoadId !== loadId
            ) {
              return
            }

            entriesByLibraryId.delete(library.id)
            updateEntries()
            reportRejection(error)
          })
      }
    })
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'home-projects.configured-project-library-entries',
      provides: [
        provide(homeProjectEntriesValueSpec, entries, {
          key: 'home-projects.configured-project-library-entries',
        }),
      ],
      dispose: () => {
        disposed = true
        abortController?.abort()
        disposeConfiguredProjectLibraryEntriesEffect?.()
      },
    }),
  }
}, 'home-projects.configured-project-library-entries')

const homeProjectsExtension = defineRegistryItem({
  id: 'home-projects',
  uses: [
    directoryProjectLibraryType,
    configuredProjectLibraries,
    configuredProjectLibraryEntries,
    homeProjectActions,
    systemIOLocalHomeProjectEntries,
  ],
})

export default homeProjectsExtension
