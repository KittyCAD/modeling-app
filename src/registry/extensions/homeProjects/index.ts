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
import fsZds from '@src/lib/fs-zds'
import {
  getHomeProjectDisplayName,
  homeProjectEntryFromProject,
} from '@src/lib/homeProjects'
import type { Project } from '@src/lib/project'
import { readProjectsFromProjectDirectory } from '@src/lib/projectLibraries/directoryScanner'
import { createProjectInLocalDirectory } from '@src/lib/projectLibraries/operations'
import {
  DEFAULT_PROJECT_LIBRARY_ID,
  DEFAULT_PROJECT_LIBRARY_TITLE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  NEW_PROJECT_LIBRARY_TITLE,
  getDefaultDirectoryProjectLibraryPath,
  getDefaultProjectLibrarySettings,
  type ProjectLibrary,
  projectLibraryFromSetting,
} from '@src/lib/projectLibraries'
import { DirectoryProjectLibrarySettingsDetails } from '@src/lib/projectLibraries/settings/ProjectLibrariesSettingInput'
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
  getProjectLibraryOperation,
  projectLibrariesValueSpec,
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibraryTypesValueSpec,
  type ProjectLibraryTypeOperations,
} from '@src/registry/contracts/projectLibraries'
import { settingsService } from '@src/registry/contracts/settings'
import { systemIOService } from '@src/registry/contracts/systemIO'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import toast from 'react-hot-toast'

const configuredProjectLibraryEntriesInvalidation = signal(0)

export function invalidateConfiguredProjectLibraryEntries() {
  configuredProjectLibraryEntriesInvalidation.value += 1
}

function readConfiguredProjectLibraryEntriesInvalidation() {
  return configuredProjectLibraryEntriesInvalidation.value
}

function localHomeProjectEntriesFromProjects(
  projects: readonly Project[] | undefined,
  libraryId?: string
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

  const getProjectOperation = <
    OperationName extends keyof ProjectLibraryTypeOperations,
  >(
    project: HomeProjectEntry,
    operationName: OperationName
  ):
    | {
        library: ProjectLibrary
        operation: NonNullable<ProjectLibraryTypeOperations[OperationName]>
      }
    | undefined => {
    const projectLibraryIds = new Set(project.libraryIds ?? [])
    if (projectLibraryIds.size === 0) {
      return undefined
    }

    const libraryTypes = ctx.valueSpecs.get(projectLibraryTypesValueSpec)
    for (const library of ctx.valueSpecs.get(projectLibrariesValueSpec)) {
      if (!projectLibraryIds.has(library.id)) {
        continue
      }

      const operation = getProjectLibraryOperation(
        libraryTypes.get(library.type),
        library,
        operationName
      )
      if (!operation) {
        continue
      }

      return {
        library,
        operation,
      }
    }

    return undefined
  }

  const serviceImpl: HomeProjectActionsService = {
    canOpen: (project) =>
      Boolean(
        (project.readWriteAccess &&
          project.defaultFile &&
          getProjectOperation(project, 'openProject')) ||
          project.remoteProjectId
      ),
    canRename: (project) =>
      Boolean(
        project.localProjectPath &&
          project.readWriteAccess &&
          getProjectOperation(project, 'renameProject')
      ),
    canDelete: (project) =>
      Boolean(
        project.localProjectPath &&
          project.readWriteAccess &&
          getProjectOperation(project, 'deleteProject')
      ),
    open: async (project) => {
      const openProject = getProjectOperation(project, 'openProject')
      if (openProject && project.readWriteAccess && project.defaultFile) {
        return openProject.operation.run({
          library: openProject.library,
          project,
        })
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
      const renameProject = getProjectOperation(project, 'renameProject')
      if (!serviceImpl.canRename(project) || !renameProject) {
        return
      }

      if (
        homeProjectDisplayNameExists({
          entries: ctx.valueSpecs.get(homeProjectEntriesValueSpec),
          requestedName,
          projectId: project.id,
        })
      ) {
        const message = `Project with title "${requestedName}" already exists`
        toast.error(message)
        return Promise.reject(new Error(message))
      }

      await renameProject.operation.run({
        library: renameProject.library,
        project,
        requestedName,
      })
      toast.success(
        `Successfully renamed "${getHomeProjectDisplayName(project)}" to "${requestedName}"`
      )
    },
    delete: async (project) => {
      const deleteProject = getProjectOperation(project, 'deleteProject')
      if (!serviceImpl.canDelete(project) || !deleteProject) {
        return
      }

      await deleteProject.operation.run({
        library: deleteProject.library,
        project,
      })
      toast.success(
        `Successfully deleted "${getHomeProjectDisplayName(project)}"`
      )
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

const configuredProjectLibraries = defineRegistryItemFactory((ctx) => {
  const settings = ctx.services.signal(settingsService)
  const libraries = computed<ProjectLibrary[]>(() => {
    const currentSettings = settings.value?.current.value
    if (!currentSettings) {
      return []
    }

    const defaultProjectDirectory = getDefaultDirectoryProjectLibraryPath(
      currentSettings.app.libraries.current
    )

    return currentSettings.app.libraries.current.map((library, index) => ({
      ...projectLibraryFromSetting(library, index, {
        defaultProjectDirectory,
      }),
      icon: 'folder',
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

const directoryProjectLibraryType = defineRegistryItemFactory((ctx) => {
  const systemIO = ctx.services.signal(systemIOService)
  const getWasmPromise = () =>
    ctx.valueSpecs.get(wasmPromiseValueSpec) ??
    Promise.reject(new Error('Missing WASM promise registry value.'))

  return {
    item: defineRuntimeRegistryItem({
      id: 'home-projects.directory-library-type',
      provides: [
        provide(projectLibraryTypesValueSpec, {
          type: DIRECTORY_PROJECT_LIBRARY_TYPE,
          title: 'Directory',
          icon: 'folder',
          order: 0,
          defaultSetting: {
            title: DEFAULT_PROJECT_LIBRARY_TITLE,
            path: 'projects',
            type: DIRECTORY_PROJECT_LIBRARY_TYPE,
          },
          newLibrarySetting: {
            title: NEW_PROJECT_LIBRARY_TITLE,
            path: 'projects',
            type: DIRECTORY_PROJECT_LIBRARY_TYPE,
          },
          settingsDetails: DirectoryProjectLibrarySettingsDetails,
          hideInSettingsOnPlatform: 'web',
          readEntries: async ({ library, signal }) => {
            const projects = await readProjectsFromProjectDirectory({
              projectDirectoryPath: library.path,
              wasmInstancePromise: getWasmPromise(),
              signal,
            })

            return localHomeProjectEntriesFromProjects(projects, library.id)
          },
          operations: {
            createProject: {
              run: async ({
                library,
                requestedProjectName,
                requestedProjectTitle,
              }) => {
                const project = await createProjectInLocalDirectory({
                  projectDirectoryPath: library.path,
                  requestedProjectName,
                  requestedProjectTitle,
                  wasmInstancePromise: getWasmPromise(),
                })
                systemIO.value?.actor.send({
                  type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
                })
                invalidateConfiguredProjectLibraryEntries()

                return project
              },
            },
            openProject: {
              run: ({ project }) => {
                if (!project.readWriteAccess || !project.defaultFile) {
                  return undefined
                }

                return { defaultFile: project.defaultFile }
              },
            },
            renameProject: {
              run: async ({ project, requestedName }) => {
                if (!project.localProjectPath || !project.readWriteAccess) {
                  return
                }

                await writeProjectTitleToProjectToml(
                  project.localProjectPath,
                  requestedName
                )
                systemIO.value?.actor.send({
                  type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
                })
                invalidateConfiguredProjectLibraryEntries()
              },
            },
            deleteProject: {
              run: async ({ project }) => {
                if (!project.localProjectPath || !project.readWriteAccess) {
                  return
                }

                await fsZds.rm(project.localProjectPath, {
                  recursive: true,
                })
                systemIO.value?.actor.send({
                  type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
                })
                invalidateConfiguredProjectLibraryEntries()
              },
            },
          },
        }),
      ],
    }),
  }
}, 'home-projects.directory-library-type')

const directoryProjectLibraryDefaultPolicy = defineRegistryItem({
  id: 'home-projects.directory-library-default-policy',
  provides: [
    provide(projectLibrarySettingDefaultPoliciesValueSpec, {
      id: 'home-projects.directory-library-default-policy',
      priority: 0,
      /**
       * Product policy: the directory library owns the legacy default project
       * directory fallback. Other library systems can contribute
       * higher-priority policies without `loadAndValidateSettings()` knowing
       * about their storage type.
       */
      getDefaultLibraries: ({ legacyProjectDirectory, initialDefaultDir }) =>
        getDefaultProjectLibrarySettings(
          legacyProjectDirectory ?? initialDefaultDir
        ),
    }),
  ],
})

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

  // Defer because `effect` runs immediately, and service reads are blocked
  // while the registry graph is still being built.
  queueMicrotask(() => {
    if (disposed) {
      return
    }

    disposeConfiguredProjectLibraryEntriesEffect = effect(() => {
      const currentSettings = settings.value?.current.value
      const typeById = libraryTypes.value
      // Directory library operations mutate the filesystem without changing
      // settings or library type registrations. Read this signal so known
      // mutations can invalidate and rescan configured library entries.
      readConfiguredProjectLibraryEntriesInvalidation()
      const nextLoadId = ++loadId

      abortController?.abort()
      const loadController = new AbortController()
      abortController = loadController
      entriesByLibraryId.clear()
      entries.value = []

      if (!currentSettings) {
        return
      }

      const defaultProjectDirectory = getDefaultDirectoryProjectLibraryPath(
        currentSettings.app.libraries.current
      )
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
    configuredProjectLibraries,
    configuredProjectLibraryEntries,
    directoryProjectLibraryDefaultPolicy,
    directoryProjectLibraryType,
    homeProjectActions,
    systemIOLocalHomeProjectEntries,
  ],
})

export default homeProjectsExtension
