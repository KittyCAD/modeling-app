import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import {
  getCloudProjectLibraryMaterializationDirectoryPath,
  getDefaultCloudProjectDirectoryPath,
} from '@src/lib/cloudSync/paths'
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
import { duplicateProjectInDirectory } from '@src/lib/projectDuplication'
import {
  DEFAULT_PROJECT_LIBRARY_ID,
  DEFAULT_PROJECT_LIBRARY_TITLE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  getDefaultProjectLibrarySettings,
  NEW_PROJECT_LIBRARY_TITLE,
  type ProjectLibrary,
  projectLibrariesFromSettings,
} from '@src/lib/projectLibraries'
import {
  readProjectsFromProjectDirectory,
  scheduleProjectDirectoryNameSyncFromTitles,
} from '@src/lib/projectLibraries/directoryScanner'
import {
  createProjectInLocalDirectory,
  moveProjectIntoLocalDirectory,
} from '@src/lib/projectLibraries/operations'
import { DirectoryProjectLibrarySettingsDetails } from '@src/lib/projectLibraries/settings/ProjectLibrariesSettingInput'
import {
  ExpectedSystemIOError,
  reportSystemIOError,
  type SystemIOErrorRisk,
} from '@src/lib/systemIOErrorReporting'
import { reportRejection } from '@src/lib/trap'
import {
  NO_PROJECT_DIRECTORY,
  SystemIOMachineActors,
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import { commandSystemService } from '@src/registry/contracts/commands'
import {
  type HomeProjectActionsService,
  type HomeProjectEntry,
  type HomeProjectEntryContribution,
  type HomeProjectMoveToLibraryTarget,
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import { projectExplorerProjectMenuItemsValueSpec } from '@src/registry/contracts/projectExplorer'
import {
  getProjectLibraryOperation,
  type ProjectLibraryTypeOperations,
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { settingsService } from '@src/registry/contracts/settings'
import { systemIOService } from '@src/registry/contracts/systemIO'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import toast from 'react-hot-toast'

const configuredProjectLibraryEntriesInvalidation = signal(0)

async function runReportedDirectoryProjectOperation<T>({
  operation,
  risk,
  extra,
  run,
}: {
  operation: string
  risk: SystemIOErrorRisk
  extra?: Record<string, unknown>
  run: () => Promise<T> | T
}): Promise<T> {
  try {
    return await run()
  } catch (error) {
    reportSystemIOError({
      error,
      operation,
      risk,
      source: 'DirectoryProjectLibrary',
      extra,
    })
    return Promise.reject(error)
  }
}

function reportDirectoryProjectStatFailures({
  error,
  count,
}: {
  error: unknown
  count: number
}) {
  reportSystemIOError({
    error,
    operation: SystemIOMachineActors.readFoldersFromProjectDirectory,
    risk: 'read',
    source: 'DirectoryProjectLibrary',
    dedupeKey:
      'SystemIO:DirectoryProjectLibrary:read folders from project directory:stat_project',
    extra: {
      phase: 'stat_project',
      skippedProjectCount: count,
    },
  })
}

function reportProjectDirectoryRenameFailure(error: unknown) {
  reportSystemIOError({
    error,
    operation: SystemIOMachineActors.renameProject,
    risk: 'write',
    source: 'DirectoryProjectLibrary',
    dedupeKey:
      'SystemIO:DirectoryProjectLibrary:rename project:sync_directory_name',
    extra: {
      phase: 'sync_directory_name',
      partialMutationPossible: true,
      dataLossPossible: false,
    },
  })
}

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

function getProjectMoveSource({ project }: { project: HomeProjectEntry }) {
  if (!project.localProjectPath || !project.readWriteAccess) {
    return undefined
  }

  return {
    localProjectPath: project.localProjectPath,
    localProjectName:
      project.localProjectName ?? fsZds.basename(project.localProjectPath),
    defaultFile: project.defaultFile,
  }
}

const homeProjectActions = defineRegistryItemFactory((ctx) => {
  const settings = ctx.services.signal(settingsService)
  const cloudSync = ctx.services.signal(cloudSyncService)

  const getWasmPromise = () =>
    ctx.valueSpecs.get(wasmPromiseValueSpec) ??
    new Error('Missing WASM promise registry value.')

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
    for (const library of getConfiguredProjectLibraries()) {
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

  const getProjectLibraries = (project: HomeProjectEntry) => {
    const projectLibraryIds = new Set(project.libraryIds ?? [])
    if (projectLibraryIds.size === 0) {
      return []
    }

    return getConfiguredProjectLibraries().filter((library) =>
      projectLibraryIds.has(library.id)
    )
  }

  const getConfiguredProjectLibraries = () => {
    const currentSettings = settings.value?.current.value
    return currentSettings
      ? projectLibrariesFromSettings(currentSettings.app.libraries.current)
      : []
  }

  const getMoveToLibraryTargets = (
    project: HomeProjectEntry
  ): HomeProjectMoveToLibraryTarget[] => {
    const projectLibraryIds = new Set(project.libraryIds ?? [])
    const libraryTypes = ctx.valueSpecs.get(projectLibraryTypesValueSpec)
    const libraries = getConfiguredProjectLibraries()
    const targets: HomeProjectMoveToLibraryTarget[] = []
    const targetLibraryIds = new Set<string>()

    for (const sourceLibrary of getProjectLibraries(project)) {
      const moveFrom = getProjectLibraryOperation(
        libraryTypes.get(sourceLibrary.type),
        sourceLibrary,
        'moveProjectFrom'
      )
      if (
        !moveFrom ||
        moveFrom.canMoveProject?.({ library: sourceLibrary, project }) === false
      ) {
        continue
      }

      for (const library of libraries) {
        if (
          projectLibraryIds.has(library.id) ||
          targetLibraryIds.has(library.id)
        ) {
          continue
        }

        const moveTo = getProjectLibraryOperation(
          libraryTypes.get(library.type),
          library,
          'moveProjectTo'
        )
        if (
          !moveTo ||
          moveTo.canReceiveProject?.({
            library,
            sourceLibrary,
            project,
          }) === false
        ) {
          continue
        }

        targets.push({
          library,
          sourceLibrary,
        })
        targetLibraryIds.add(library.id)
      }
    }

    return targets
  }

  const getMoveToLibraryTarget = (
    project: HomeProjectEntry,
    targetLibraryId: string
  ) =>
    getMoveToLibraryTargets(project).find(
      (target) => target.library.id === targetLibraryId
    )

  const serviceImpl: HomeProjectActionsService = {
    canOpen: (project) =>
      Boolean(
        (project.readWriteAccess &&
          project.defaultFile &&
          getProjectOperation(project, 'openProject')) ||
          project.remoteProjectId
      ),
    canDuplicate: (project) =>
      Boolean(
        ((project.localProjectName && project.localProjectPath) ||
          project.remoteProjectId) &&
          getProjectOperation(project, 'duplicateProject')
      ),
    // A local materialization is not required: cloud library operations can act
    // on a remote-only project directly. Each library type's operation guards
    // its own local-vs-remote handling, so the shared capability check only
    // needs write access plus a registered operation.
    canRename: (project) =>
      Boolean(
        project.readWriteAccess && getProjectOperation(project, 'renameProject')
      ),
    canDelete: (project) =>
      Boolean(
        project.readWriteAccess && getProjectOperation(project, 'deleteProject')
      ),
    canMoveToLibrary: (project) => getMoveToLibraryTargets(project).length > 0,
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

      const targetProjectDirectoryPath = openProject
        ? await getCloudProjectLibraryMaterializationDirectoryPath(
            openProject.library
          )
        : await getDefaultCloudProjectDirectoryPath()
      const syncedProject = await cloudSync.value?.ensureProjectLocallySynced(
        project.remoteProjectId,
        targetProjectDirectoryPath
      )
      if (!syncedProject) {
        return undefined
      }

      const wasmInstancePromise = getWasmPromise()
      if (wasmInstancePromise instanceof Error) {
        return Promise.reject(wasmInstancePromise)
      }

      const projectInfo = await getProjectInfo(
        syncedProject.projectPath,
        await wasmInstancePromise
      )
      return { defaultFile: projectInfo.default_file }
    },
    duplicate: async (project) => {
      const duplicateProject = getProjectOperation(project, 'duplicateProject')
      if (!serviceImpl.canDuplicate(project) || !duplicateProject) {
        return
      }

      const result = await duplicateProject.operation.run({
        library: duplicateProject.library,
        project,
      })
      if (result) {
        toast.success(result.message)
      }
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
    getMoveToLibraryTargets,
    moveToLibrary: async (project, targetLibraryId) => {
      const target = getMoveToLibraryTarget(project, targetLibraryId)
      if (!target) {
        return undefined
      }

      const libraryTypes = ctx.valueSpecs.get(projectLibraryTypesValueSpec)
      const moveFrom = getProjectLibraryOperation(
        libraryTypes.get(target.sourceLibrary.type),
        target.sourceLibrary,
        'moveProjectFrom'
      )
      const moveTo = getProjectLibraryOperation(
        libraryTypes.get(target.library.type),
        target.library,
        'moveProjectTo'
      )
      if (!moveFrom || !moveTo) {
        return undefined
      }

      const source = await moveFrom.run({
        library: target.sourceLibrary,
        project,
        targetLibrary: target.library,
      })
      if (!source) {
        return undefined
      }

      const result = await moveTo.run({
        library: target.library,
        sourceLibrary: target.sourceLibrary,
        project,
        source,
      })
      toast.success(
        `Moved "${getHomeProjectDisplayName(project)}" to "${target.library.title}".`
      )

      return result?.defaultFile
        ? {
            defaultFile: result.defaultFile,
          }
        : undefined
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
        const snapshot = service.actor.getSnapshot()
        const context = snapshot.context
        const projects = context.folders
        if (projects !== undefined) {
          entries.value = localHomeProjectEntriesFromProjects(
            projects,
            DEFAULT_PROJECT_LIBRARY_ID
          )
        }

        if (
          projects &&
          snapshot.matches(SystemIOMachineStates.idle) &&
          context.requestedProjectName.name === NO_PROJECT_DIRECTORY
        ) {
          scheduleProjectDirectoryNameSyncFromTitles({
            projects,
            onProjectDirectoryRenameFailure:
              reportProjectDirectoryRenameFailure,
            onProjectDirectoriesRenamed: () => {
              service.actor.send({
                type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
              })
            },
          })
        }
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

function areProjectLibrariesEqual(
  left: readonly ProjectLibrary[],
  right: readonly ProjectLibrary[]
) {
  return (
    left.length === right.length &&
    left.every((library, index) => {
      const otherLibrary = right[index]
      return (
        otherLibrary !== undefined &&
        library.id === otherLibrary.id &&
        library.title === otherLibrary.title &&
        library.path === otherLibrary.path &&
        library.type === otherLibrary.type &&
        library.order === otherLibrary.order
      )
    })
  )
}

const directoryProjectLibraryType = defineRegistryItemFactory((ctx) => {
  const systemIO = ctx.services.signal(systemIOService)
  const cloudSync = ctx.services.signal(cloudSyncService)
  const getWasmPromise = () =>
    ctx.valueSpecs.get(wasmPromiseValueSpec) ??
    new Error('Missing WASM promise registry value.')
  const refreshLocalProjectEntries = () => {
    systemIO.value?.actor.send({
      type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
    })
    invalidateConfiguredProjectLibraryEntries()
  }

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
            const wasmInstancePromise = getWasmPromise()
            if (wasmInstancePromise instanceof Error) {
              return Promise.reject(wasmInstancePromise)
            }

            return runReportedDirectoryProjectOperation({
              operation: SystemIOMachineActors.readFoldersFromProjectDirectory,
              risk: 'read',
              run: async () => {
                const projects = await readProjectsFromProjectDirectory({
                  projectDirectoryPath: library.path,
                  wasmInstancePromise,
                  signal,
                  onProjectStatFailures: reportDirectoryProjectStatFailures,
                })
                if (!signal.aborted) {
                  scheduleProjectDirectoryNameSyncFromTitles({
                    projects,
                    onProjectDirectoryRenameFailure:
                      reportProjectDirectoryRenameFailure,
                    onProjectDirectoriesRenamed:
                      invalidateConfiguredProjectLibraryEntries,
                  })
                }

                return localHomeProjectEntriesFromProjects(projects, library.id)
              },
            })
          },
          operations: {
            createProject: {
              run: async ({
                library,
                requestedProjectName,
                requestedProjectTitle,
              }) => {
                const wasmInstancePromise = getWasmPromise()
                if (wasmInstancePromise instanceof Error) {
                  return Promise.reject(wasmInstancePromise)
                }

                return runReportedDirectoryProjectOperation({
                  operation: SystemIOMachineActors.createProject,
                  risk: 'write',
                  extra: {
                    partialMutationPossible: true,
                    dataLossPossible: false,
                  },
                  run: async () => {
                    const project = await createProjectInLocalDirectory({
                      projectDirectoryPath: library.path,
                      requestedProjectName,
                      requestedProjectTitle,
                      wasmInstancePromise,
                    })
                    systemIO.value?.actor.send({
                      type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
                    })
                    invalidateConfiguredProjectLibraryEntries()

                    return project
                  },
                })
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
            duplicateProject: {
              run: async ({ library, project }) => {
                const localProjectName = project.localProjectName
                const localProjectPath = project.localProjectPath
                if (!localProjectName || !localProjectPath) {
                  return undefined
                }
                const wasmInstancePromise = getWasmPromise()
                if (wasmInstancePromise instanceof Error) {
                  return Promise.reject(wasmInstancePromise)
                }

                return runReportedDirectoryProjectOperation({
                  operation: SystemIOMachineActors.duplicateProject,
                  risk: 'write',
                  extra: {
                    partialMutationPossible: true,
                    dataLossPossible: false,
                  },
                  run: async () => {
                    const result = await duplicateProjectInDirectory({
                      source: {
                        directoryName: localProjectName,
                        displayName: getHomeProjectDisplayName(project),
                        path: localProjectPath,
                      },
                      projectDirectoryPath: library.path,
                      requestedProjectTitle: getHomeProjectDisplayName(project),
                      wasmInstance: await wasmInstancePromise,
                    })
                    systemIO.value?.actor.send({
                      type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
                    })
                    invalidateConfiguredProjectLibraryEntries()

                    return result
                  },
                })
              },
            },
            renameProject: {
              run: async ({ project, requestedName }) => {
                const localProjectPath = project.localProjectPath
                if (!localProjectPath || !project.readWriteAccess) {
                  return
                }

                return runReportedDirectoryProjectOperation({
                  operation: SystemIOMachineActors.renameProject,
                  risk: 'write',
                  extra: {
                    partialMutationPossible: true,
                    dataLossPossible: true,
                  },
                  run: async () => {
                    await writeProjectTitleToProjectToml(
                      localProjectPath,
                      requestedName
                    )
                    refreshLocalProjectEntries()
                  },
                })
              },
            },
            deleteProject: {
              run: async ({ project }) => {
                const localProjectPath = project.localProjectPath
                if (!localProjectPath || !project.readWriteAccess) {
                  return
                }

                return runReportedDirectoryProjectOperation({
                  operation: SystemIOMachineActors.deleteProject,
                  risk: 'destructive',
                  extra: {
                    partialMutationPossible: true,
                    dataLossPossible: true,
                  },
                  run: async () => {
                    const cloudSyncActions = project.remoteProjectId
                      ? cloudSync.value
                      : undefined
                    if (
                      project.remoteProjectId &&
                      cloudSyncActions?.status.value.enabled !== true
                    ) {
                      return Promise.reject(
                        new ExpectedSystemIOError('Cloud sync is not enabled.')
                      )
                    }

                    await fsZds.rm(localProjectPath, {
                      recursive: true,
                    })
                    // Individually synced directory projects follow the same
                    // delete-everywhere policy as cloud-library projects.
                    if (project.remoteProjectId) {
                      await cloudSyncActions?.deleteRemoteProject(
                        project.remoteProjectId
                      )
                    }
                    refreshLocalProjectEntries()
                  },
                })
              },
            },
            moveProjectFrom: {
              canMoveProject: ({ project }) =>
                Boolean(project.localProjectPath && project.readWriteAccess),
              run: ({ project }) => getProjectMoveSource({ project }),
            },
            moveProjectTo: {
              run: async ({ library, source }) => {
                return runReportedDirectoryProjectOperation({
                  operation: SystemIOMachineActors.moveRecursive,
                  risk: 'destructive',
                  extra: {
                    partialMutationPossible: true,
                    dataLossPossible: true,
                  },
                  run: async () => {
                    const result = await moveProjectIntoLocalDirectory({
                      projectDirectoryPath: library.path,
                      sourceProjectPath: source.localProjectPath,
                      sourceProjectName: source.localProjectName,
                      defaultFile: source.defaultFile,
                    })
                    refreshLocalProjectEntries()

                    return result
                  },
                })
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
  // Diagnostic dedupe: a configured library whose type has no registered
  // handler cannot be listed and would silently vanish from Home. This should
  // not happen (the cloud and directory types are always-on), so warn once per
  // library rather than swallowing it.
  const warnedMissingTypeLibraryIds = new Set<string>()
  let abortController: AbortController | undefined
  let disposeConfiguredProjectLibraryEntriesEffect: (() => void) | undefined
  let disposed = false
  let loadId = 0
  let lastScannedConfiguredLibraries: ProjectLibrary[] | undefined
  let lastScannedLibraryTypes: typeof libraryTypes.value | undefined
  let lastScannedInvalidation = -1

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
      const invalidation = readConfiguredProjectLibraryEntriesInvalidation()

      const configuredLibraries =
        currentSettings !== undefined
          ? projectLibrariesFromSettings(
              currentSettings.app.libraries.current
            ).filter((library) => library.id !== DEFAULT_PROJECT_LIBRARY_ID)
          : []

      if (
        lastScannedLibraryTypes === typeById &&
        lastScannedInvalidation === invalidation &&
        lastScannedConfiguredLibraries &&
        areProjectLibrariesEqual(
          lastScannedConfiguredLibraries,
          configuredLibraries
        )
      ) {
        return
      }

      lastScannedLibraryTypes = typeById
      lastScannedInvalidation = invalidation
      lastScannedConfiguredLibraries = configuredLibraries
      const nextLoadId = ++loadId

      abortController?.abort()
      const loadController = new AbortController()
      abortController = loadController
      entriesByLibraryId.clear()
      entries.value = []

      for (const library of configuredLibraries) {
        const readEntries = typeById.get(library.type)?.readEntries
        if (!readEntries) {
          if (!warnedMissingTypeLibraryIds.has(library.id)) {
            warnedMissingTypeLibraryIds.add(library.id)
            console.warn(
              `Configured project library "${library.title}" (${library.id}) has no registered "${library.type}" type handler; its projects cannot be listed.`
            )
          }
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

function findHomeProjectEntryByProjectPath(
  entries: readonly HomeProjectEntry[],
  projectPath: string
) {
  return entries.find((entry) => entry.localProjectPath === projectPath)
}

const moveProjectToLibraryProjectMenuItem = defineRegistryItemFactory((ctx) => {
  const findProject = (projectPath: string) =>
    findHomeProjectEntryByProjectPath(
      ctx.valueSpecs.get(homeProjectEntriesValueSpec),
      projectPath
    )

  return {
    item: defineRuntimeRegistryItem({
      id: 'home-projects.move-to-library-project-menu-item',
      provides: [
        provide(
          projectExplorerProjectMenuItemsValueSpec,
          {
            id: 'home-projects.move-to-library-project-menu-item',
            order: 10,
            label: 'Move to library',
            dataTestId: 'project-sidebar-move-to-library',
            isVisible: ({ projectPath }) => {
              const project = findProject(projectPath)
              const actions = ctx.services.optional(homeProjectActionsService)

              return Boolean(project && actions?.canMoveToLibrary(project))
            },
            onSelect: ({ projectPath }) => {
              const project = findProject(projectPath)
              const commandSystem = ctx.services.optional(commandSystemService)
              if (!project || !commandSystem) {
                return
              }

              commandSystem.send({
                type: 'Find and select command',
                data: {
                  groupId: 'projects',
                  name: 'Move to library',
                  argDefaultValues: {
                    project: project.id,
                  },
                },
              })
            },
          },
          { key: 'home-projects.move-to-library-project-menu-item' }
        ),
      ],
    }),
  }
}, 'home-projects.move-to-library-project-menu-item')

const homeProjectsExtension = defineRegistryItem({
  id: 'home-projects',
  uses: [
    configuredProjectLibraryEntries,
    directoryProjectLibraryDefaultPolicy,
    directoryProjectLibraryType,
    homeProjectActions,
    moveProjectToLibraryProjectMenuItem,
    systemIOLocalHomeProjectEntries,
  ],
})

export default homeProjectsExtension
