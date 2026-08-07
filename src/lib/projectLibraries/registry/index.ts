import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import { writeProjectTitleToProjectToml } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { getHomeProjectDisplayName } from '@src/lib/homeProjects'
import { duplicateProjectInDirectory } from '@src/lib/projectDuplication'
import {
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  DEFAULT_PROJECT_LIBRARY_TITLE,
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
import { projectLibraryRealizationFromProject } from '@src/lib/projectLibraries/realizations'
import {
  invalidateProjectLibraryRealizations,
  readProjectLibraryRealizationInvalidationForLibrary,
  readProjectLibraryRealizationsInvalidation,
  type ProjectLibraryRealizationsInvalidationSnapshot,
} from '@src/lib/projectLibraries/registry/invalidation'
import { DirectoryProjectLibrarySettingsDetails } from '@src/lib/projectLibraries/settings/ProjectLibrariesSettingInput'
import { projectLibrariesSettingsContribution } from '@src/lib/projectLibraries/settings/setting'
import { reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import {
  ExpectedSystemIOError,
  reportSystemIOError,
  type SystemIOErrorRisk,
} from '@src/machines/systemIO/errorReporting'
import { SystemIOMachineActors } from '@src/machines/systemIO/utils'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'
import {
  type ProjectLibraryOperation,
  type ProjectLibraryRealizationContribution,
  type ProjectLibraryRealizationsService,
  type ProjectLibraryTypeContribution,
  type ProjectLibraryTypeOperations,
  projectLibraryRealizationsService,
  projectLibraryRealizationsValueSpec,
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import {
  settingsService,
  settingsValueSpec,
} from '@src/registry/contracts/settings'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'

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

type ProjectLibraryInvalidationGeneration = {
  global: number
  library: number
}

/** Inputs whose change requires one configured library to be rediscovered. */
type ConfiguredProjectLibraryScanInput = {
  library: ProjectLibrary
  libraryType?: ProjectLibraryTypeContribution
  invalidation: ProjectLibraryInvalidationGeneration
}

type ConfiguredProjectLibraryScanState = {
  input: ConfiguredProjectLibraryScanInput
  abortController?: AbortController
  realizations: ProjectLibraryRealizationContribution[]
}

function configuredProjectLibraryScanInputIsEqual(
  left: ConfiguredProjectLibraryScanInput | undefined,
  right: ConfiguredProjectLibraryScanInput
) {
  return Boolean(
    left &&
      left.libraryType === right.libraryType &&
      left.invalidation.global === right.invalidation.global &&
      left.invalidation.library === right.invalidation.library &&
      areProjectLibrariesEqual([left.library], [right.library])
  )
}

function configuredProjectLibrarySourceIsEqual(
  left: ConfiguredProjectLibraryScanInput | undefined,
  right: ConfiguredProjectLibraryScanInput
) {
  return Boolean(
    left &&
      left.libraryType === right.libraryType &&
      areProjectLibrariesEqual([left.library], [right.library])
  )
}

function warnMissingProjectLibraryTypeHandler(
  library: ProjectLibrary,
  warnedMissingTypeLibraryIds: Set<string>
) {
  if (warnedMissingTypeLibraryIds.has(library.id)) {
    return
  }

  warnedMissingTypeLibraryIds.add(library.id)
  console.warn(
    `Configured project library "${library.title}" (${library.id}) has no registered "${library.type}" type handler; its projects cannot be listed.`
  )
}

/**
 * Reads one configured library for one discovery pass. The result is still only
 * a set of local observations; the ValueSpec combiner later merges observations
 * of the same normalized path and cloudSync handles cloud identity.
 */
async function readConfiguredProjectLibraryRealizations({
  library,
  libraryType,
  warnedMissingTypeLibraryIds,
  signal,
}: {
  library: ProjectLibrary
  libraryType?: ProjectLibraryTypeContribution
  warnedMissingTypeLibraryIds: Set<string>
  signal: AbortSignal
}): Promise<ProjectLibraryRealizationContribution[]> {
  const readRealizations = libraryType?.readRealizations
  if (!readRealizations) {
    warnMissingProjectLibraryTypeHandler(library, warnedMissingTypeLibraryIds)
    return []
  }

  try {
    return await readRealizations({ library, signal })
  } catch (error) {
    if (!signal.aborted) {
      reportRejection(error)
    }
    return []
  }
}

const PROJECT_LIBRARY_WATCH_DEBOUNCE_MS = 750
const PROJECT_LIBRARY_WATCH_SETTLED_RESCAN_MS = 3000

type ProjectLibraryWatchTarget = {
  path: string
  normalizedPath: string
  libraryIds: readonly string[]
}

type ProjectLibraryWatchPathScope =
  | 'outside'
  | 'root'
  | 'immediate-child'
  | 'nested-child'

function normalizeProjectLibraryWatchPath(path: string) {
  return path.trim().replaceAll('\\', '/').replace(/\/+$/g, '')
}

function projectLibraryWatchTargetsFromLibraries(
  libraries: readonly ProjectLibrary[]
): ProjectLibraryWatchTarget[] {
  const targetsByPath = new Map<string, ProjectLibraryWatchTarget>()

  for (const library of libraries) {
    const path = library.path.trim()
    const normalizedPath = normalizeProjectLibraryWatchPath(path)
    if (!path || !normalizedPath || normalizedPath === fsZds.sep) {
      continue
    }

    const previousTarget = targetsByPath.get(normalizedPath)
    targetsByPath.set(normalizedPath, {
      path: previousTarget?.path ?? path,
      normalizedPath,
      libraryIds: [...(previousTarget?.libraryIds ?? []), library.id],
    })
  }

  return Array.from(targetsByPath.values()).toSorted((left, right) =>
    left.normalizedPath.localeCompare(right.normalizedPath)
  )
}

/**
 * Classifies a file-watch event path relative to one configured library root.
 * Discovery only needs root and immediate-child events because each direct
 * child may be a local project realization; deeper file events belong to an
 * already-known realization and should not trigger a full library rescan.
 */
function projectLibraryWatchPathScope(
  targetPath: string,
  libraryPath: string
): ProjectLibraryWatchPathScope {
  const normalizedTargetPath = normalizeProjectLibraryWatchPath(targetPath)
  const normalizedLibraryPath = normalizeProjectLibraryWatchPath(libraryPath)

  if (normalizedTargetPath === normalizedLibraryPath) {
    return 'root'
  }

  const libraryPrefix = `${normalizedLibraryPath}/`
  if (!normalizedTargetPath.startsWith(libraryPrefix)) {
    return 'outside'
  }

  const relativePath = normalizedTargetPath.slice(libraryPrefix.length)
  return relativePath.includes('/') ? 'nested-child' : 'immediate-child'
}

const PROJECT_LIBRARY_REALIZATION_INVALIDATION_EVENT_TYPES = new Set([
  'add',
  'addDir',
  'change',
  'unlink',
  'unlinkDir',
])

function shouldInvalidateProjectLibraryRealizationsForWatchEvent(
  eventType: string,
  targetPath: string,
  libraryPath: string
) {
  if (!PROJECT_LIBRARY_REALIZATION_INVALIDATION_EVENT_TYPES.has(eventType)) {
    return false
  }

  const pathScope = projectLibraryWatchPathScope(targetPath, libraryPath)
  return pathScope === 'root' || pathScope === 'immediate-child'
}

function watchConfiguredProjectLibraries({
  libraries,
  onInvalidateLibrary,
}: {
  libraries: readonly ProjectLibrary[]
  onInvalidateLibrary: (libraryId: string) => void
}) {
  if (typeof window === 'undefined' || !window.electron) {
    return () => {}
  }

  const targets = projectLibraryWatchTargetsFromLibraries(libraries)
  const timersByLibraryId = new Map<string, ReturnType<typeof setTimeout>>()
  const settledTimersByLibraryId = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()
  const watcherKeysByPath = new Map<string, string>()

  const scheduleInvalidation = (libraryId: string) => {
    clearTimeout(timersByLibraryId.get(libraryId))
    timersByLibraryId.set(
      libraryId,
      setTimeout(() => {
        timersByLibraryId.delete(libraryId)
        onInvalidateLibrary(libraryId)
      }, PROJECT_LIBRARY_WATCH_DEBOUNCE_MS)
    )
  }

  const scheduleSettledInvalidation = (libraryId: string) => {
    clearTimeout(settledTimersByLibraryId.get(libraryId))
    settledTimersByLibraryId.set(
      libraryId,
      setTimeout(() => {
        settledTimersByLibraryId.delete(libraryId)
        onInvalidateLibrary(libraryId)
      }, PROJECT_LIBRARY_WATCH_SETTLED_RESCAN_MS)
    )
  }

  for (const target of targets) {
    const watcherKey = `project-library-realizations:${uuidv4()}`
    watcherKeysByPath.set(target.path, watcherKey)
    window.electron.watchFileOn(
      target.path,
      watcherKey,
      (eventType, targetPath) => {
        if (
          !shouldInvalidateProjectLibraryRealizationsForWatchEvent(
            eventType,
            targetPath,
            target.path
          )
        ) {
          return
        }

        for (const libraryId of target.libraryIds) {
          scheduleInvalidation(libraryId)
          if (eventType === 'addDir') {
            // Root-only watchers see the project folder creation, not every file
            // copied into it. A settled follow-up catches slower external copies.
            scheduleSettledInvalidation(libraryId)
          }
        }
      },
      { depth: 0 }
    )
  }

  return () => {
    for (const timer of timersByLibraryId.values()) {
      clearTimeout(timer)
    }
    for (const timer of settledTimersByLibraryId.values()) {
      clearTimeout(timer)
    }
    for (const [path, watcherKey] of watcherKeysByPath) {
      window.electron?.watchFileOff(path, watcherKey)
    }
  }
}

/**
 * Discovery signal for configured project libraries, including the default
 * directory library. This layer owns local realization discovery and library
 * membership only; cloud identity and duplicate policy are handled by cloudSync.
 */
const configuredProjectLibraryRealizations = defineRegistryItemFactory(
  (ctx) => {
    const settings = ctx.services.signal(settingsService)
    const libraryTypes = ctx.valueSpecs.signal(projectLibraryTypesValueSpec)
    const realizations = signal<ProjectLibraryRealizationContribution[]>([])
    const warnedMissingTypeLibraryIds = new Set<string>()
    const scanStates = new Map<string, ConfiguredProjectLibraryScanState>()
    let disposeConfiguredProjectLibraryRealizationsEffect:
      | (() => void)
      | undefined
    let disposed = false
    let currentLibraryIds: readonly string[] = []

    const updateRealizations = () => {
      realizations.value = currentLibraryIds.flatMap(
        (libraryId) => scanStates.get(libraryId)?.realizations ?? []
      )
    }

    const scanLibrary = (
      library: ProjectLibrary,
      libraryType: ProjectLibraryTypeContribution | undefined,
      invalidation: ProjectLibraryRealizationsInvalidationSnapshot
    ) => {
      /**
       * Cached scan state is the active discovery cache entry for this library.
       * It lets unchanged inputs skip redundant rescans, aborts stale in-flight
       * reads when a new scan replaces them, keeps existing realizations visible
       * while the same library source refreshes, and gives async completions a
       * stable identity check before they publish results.
       */
      const cachedScan = scanStates.get(library.id)
      const input: ConfiguredProjectLibraryScanInput = {
        library,
        libraryType,
        invalidation: readProjectLibraryRealizationInvalidationForLibrary(
          invalidation,
          library.id
        ),
      }

      if (configuredProjectLibraryScanInputIsEqual(cachedScan?.input, input)) {
        return
      }

      cachedScan?.abortController?.abort()
      const readRealizations = libraryType?.readRealizations
      if (!readRealizations) {
        warnMissingProjectLibraryTypeHandler(
          library,
          warnedMissingTypeLibraryIds
        )
        scanStates.set(library.id, {
          input,
          realizations: [],
        })
        return
      }

      const abortController = new AbortController()
      const state: ConfiguredProjectLibraryScanState = {
        input,
        abortController,
        realizations: configuredProjectLibrarySourceIsEqual(
          cachedScan?.input,
          input
        )
          ? (cachedScan?.realizations ?? [])
          : [],
      }
      scanStates.set(library.id, state)

      void readConfiguredProjectLibraryRealizations({
        library,
        libraryType,
        warnedMissingTypeLibraryIds,
        signal: abortController.signal,
      }).then((nextRealizations) => {
        if (
          disposed ||
          abortController.signal.aborted ||
          scanStates.get(library.id) !== state
        ) {
          return
        }

        state.abortController = undefined
        state.realizations = nextRealizations
        updateRealizations()
      })
    }

    queueMicrotask(() => {
      if (disposed) {
        return
      }

      disposeConfiguredProjectLibraryRealizationsEffect = effect(() => {
        const currentSettings = settings.value?.current.value
        const typeById = libraryTypes.value
        const invalidation = readProjectLibraryRealizationsInvalidation()
        const libraries = currentSettings
          ? projectLibrariesFromSettings(currentSettings.app.libraries.current)
          : []
        const activeLibraryIds = new Set(libraries.map((library) => library.id))
        currentLibraryIds = libraries.map((library) => library.id)

        for (const [libraryId, state] of scanStates) {
          if (!activeLibraryIds.has(libraryId)) {
            state.abortController?.abort()
            scanStates.delete(libraryId)
          }
        }

        libraries.forEach((library) => {
          scanLibrary(library, typeById.get(library.type), invalidation)
        })
        updateRealizations()
      })
    })

    return {
      item: defineRuntimeRegistryItem({
        id: 'project-libraries.configured-realizations',
        provides: [
          provide(projectLibraryRealizationsValueSpec, realizations, {
            key: 'project-libraries.configured-realizations',
          }),
        ],
        dispose: () => {
          disposed = true
          for (const state of scanStates.values()) {
            state.abortController?.abort()
          }
          disposeConfiguredProjectLibraryRealizationsEffect?.()
        },
      }),
    }
  },
  'project-libraries.configured-realizations'
)

const projectLibraryRealizationsRegistryService = defineRegistryItem({
  id: 'project-libraries.realizations-service',
  providesServices: [
    provideService(projectLibraryRealizationsService, {
      invalidate: invalidateProjectLibraryRealizations,
      watchConfiguredLibraries: ({ libraries }) =>
        watchConfiguredProjectLibraries({
          libraries,
          onInvalidateLibrary: (libraryId) =>
            invalidateProjectLibraryRealizations({ libraryId }),
        }),
    } satisfies ProjectLibraryRealizationsService),
  ],
})

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

type DirectoryProjectOperationReport = {
  operation: string
  risk: SystemIOErrorRisk
}

async function runReportedDirectoryProjectOperation<T>({
  run,
  ...report
}: DirectoryProjectOperationReport & {
  run: () => Promise<T> | T
}): Promise<T> {
  try {
    return await run()
  } catch (error) {
    reportSystemIOError({
      error,
      source: 'DirectoryProjectLibrary',
      ...report,
    })
    return Promise.reject(error)
  }
}

function withReportedDirectoryProjectOperation<
  Input extends { library: ProjectLibrary },
  Result,
>(
  operation: ProjectLibraryOperation<Input, Result>,
  report: DirectoryProjectOperationReport
): ProjectLibraryOperation<Input, Result> {
  return {
    ...operation,
    run: (input) =>
      runReportedDirectoryProjectOperation({
        ...report,
        run: () => operation.run(input),
      }),
  }
}

function withReportedDirectoryProjectOperations(
  operations: ProjectLibraryTypeOperations
): ProjectLibraryTypeOperations {
  const report = <Input extends { library: ProjectLibrary }, Result>(
    operation: ProjectLibraryOperation<Input, Result> | undefined,
    metadata: DirectoryProjectOperationReport
  ) =>
    operation
      ? withReportedDirectoryProjectOperation(operation, metadata)
      : undefined

  return {
    ...operations,
    createProject: report(operations.createProject, {
      operation: SystemIOMachineActors.createProject,
      risk: 'write',
    }),
    duplicateProject: report(operations.duplicateProject, {
      operation: SystemIOMachineActors.duplicateProject,
      risk: 'write',
    }),
    renameProject: report(operations.renameProject, {
      operation: SystemIOMachineActors.renameProject,
      risk: 'write',
    }),
    deleteProject: report(operations.deleteProject, {
      operation: SystemIOMachineActors.deleteProject,
      risk: 'destructive',
    }),
    moveProjectTo: report(operations.moveProjectTo, {
      operation: SystemIOMachineActors.moveRecursive,
      risk: 'destructive',
    }),
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

const directoryProjectLibraryType = defineRegistryItemFactory((ctx) => {
  const cloudSync = ctx.services.signal(cloudSyncService)
  const getWasmPromise = () =>
    ctx.valueSpecs.get(wasmPromiseValueSpec) ??
    new ExpectedSystemIOError('Missing WASM promise registry value.')
  /**
   * Directory operations know the configured library they changed, so they
   * refresh that library's local realization discovery directly.
   */
  const refreshLocalProjectRealizations = (
    ...libraries: readonly ProjectLibrary[]
  ) => {
    for (const library of libraries) {
      invalidateProjectLibraryRealizations({ libraryId: library.id })
    }
  }

  const operations: ProjectLibraryTypeOperations = {
    createProject: {
      run: async ({ library, requestedProjectName, requestedProjectTitle }) => {
        const wasmInstancePromise = getWasmPromise()
        if (wasmInstancePromise instanceof Error) {
          return Promise.reject(wasmInstancePromise)
        }

        const project = await createProjectInLocalDirectory({
          projectDirectoryPath: library.path,
          requestedProjectName,
          requestedProjectTitle,
          wasmInstancePromise,
        })
        refreshLocalProjectRealizations(library)

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
    duplicateProject: {
      run: async ({ library, project }) => {
        if (!project.localProjectName || !project.localProjectPath) {
          return undefined
        }
        const wasmInstancePromise = getWasmPromise()
        if (wasmInstancePromise instanceof Error) {
          return Promise.reject(wasmInstancePromise)
        }

        const result = await duplicateProjectInDirectory({
          source: {
            directoryName: project.localProjectName,
            displayName: getHomeProjectDisplayName(project),
            path: project.localProjectPath,
          },
          projectDirectoryPath: library.path,
          requestedProjectTitle: getHomeProjectDisplayName(project),
          wasmInstance: await wasmInstancePromise,
        })
        refreshLocalProjectRealizations(library)

        return result
      },
    },
    renameProject: {
      run: async ({ library, project, requestedName }) => {
        if (!project.localProjectPath || !project.readWriteAccess) {
          return
        }

        await writeProjectTitleToProjectToml(
          project.localProjectPath,
          requestedName
        )
        refreshLocalProjectRealizations(library)
      },
    },
    deleteProject: {
      run: async ({ library, project }) => {
        if (!project.localProjectPath || !project.readWriteAccess) {
          return
        }

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

        if (project.remoteProjectId) {
          await cloudSyncActions?.deleteLocalProjectRealizations(
            project.remoteProjectId,
            project.localProjectPath
          )
        } else {
          await fsZds.rm(project.localProjectPath, {
            recursive: true,
          })
        }
        refreshLocalProjectRealizations(library)
      },
    },
    moveProjectFrom: {
      canMoveProject: ({ project }) =>
        Boolean(project.localProjectPath && project.readWriteAccess),
      run: ({ project }) => getProjectMoveSource({ project }),
    },
    moveProjectTo: {
      run: async ({ library, sourceLibrary, source }) => {
        const result = await moveProjectIntoLocalDirectory({
          projectDirectoryPath: library.path,
          sourceProjectPath: source.localProjectPath,
          sourceProjectName: source.localProjectName,
          defaultFile: source.defaultFile,
        })
        refreshLocalProjectRealizations(sourceLibrary, library)

        return result
      },
    },
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'project-libraries.directory-library-type',
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
          /**
           * Directory libraries return concrete folders on disk. Any cloud
           * project ID found in project metadata is carried as an observation,
           * not used here to merge or discard local realizations.
           */
          readRealizations: async ({ library, signal }) => {
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
                    onProjectDirectoriesRenamed: () =>
                      invalidateProjectLibraryRealizations({
                        libraryId: library.id,
                      }),
                  })
                }

                return projects.map((project) =>
                  projectLibraryRealizationFromProject(project, library)
                )
              },
            })
          },
          operations: withReportedDirectoryProjectOperations(operations),
        }),
      ],
    }),
  }
}, 'project-libraries.directory-library-type')

const directoryProjectLibraryDefaultPolicy = defineRegistryItem({
  id: 'project-libraries.directory-library-default-policy',
  provides: [
    provide(projectLibrarySettingDefaultPoliciesValueSpec, {
      id: 'project-libraries.directory-library-default-policy',
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

const projectLibrariesExtension = defineRegistryItem({
  id: 'project-libraries',
  uses: [
    configuredProjectLibraryRealizations,
    directoryProjectLibraryDefaultPolicy,
    directoryProjectLibraryType,
    projectLibraryRealizationsRegistryService,
  ],
  provides: [provide(settingsValueSpec, projectLibrariesSettingsContribution)],
})

export {
  invalidateProjectLibraryRealizations,
  readProjectLibraryRealizationsInvalidation,
}

export default projectLibrariesExtension
