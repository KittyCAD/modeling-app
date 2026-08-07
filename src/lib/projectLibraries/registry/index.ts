import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
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
  readProjectLibraryRealizationsInvalidation,
} from '@src/lib/projectLibraries/registry/invalidation'
import { DirectoryProjectLibrarySettingsDetails } from '@src/lib/projectLibraries/settings/ProjectLibrariesSettingInput'
import { projectLibrariesSettingsContribution } from '@src/lib/projectLibraries/settings/setting'
import { reportRejection } from '@src/lib/trap'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'
import {
  type ProjectLibraryRealizationContribution,
  type ProjectLibraryTypeContribution,
  type ProjectLibraryTypeOperations,
  projectLibraryRealizationsValueSpec,
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import {
  settingsService,
  settingsValueSpec,
} from '@src/registry/contracts/settings'
import { systemIOService } from '@src/registry/contracts/systemIO'
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

/** Inputs whose change requires configured libraries to be rediscovered. */
type ConfiguredProjectLibraryScanInputs = {
  libraries: readonly ProjectLibrary[]
  libraryTypes: ReadonlyMap<string, ProjectLibraryTypeContribution>
  invalidation: number
}

/**
 * Avoids rescanning when unrelated settings updates produce new settings object
 * identities but the library list, type handlers, and invalidation token are
 * unchanged.
 */
function configuredProjectLibraryScanInputsAreEqual(
  left: ConfiguredProjectLibraryScanInputs | undefined,
  right: ConfiguredProjectLibraryScanInputs
) {
  return Boolean(
    left &&
      left.libraryTypes === right.libraryTypes &&
      left.invalidation === right.invalidation &&
      areProjectLibrariesEqual(left.libraries, right.libraries)
  )
}

/**
 * Reads every configured library for one discovery pass. Results are flattened
 * without identity resolution; the value spec combiner later merges only
 * observations of the same normalized local path.
 */
async function readConfiguredProjectLibraryRealizations({
  libraries,
  libraryTypes,
  warnedMissingTypeLibraryIds,
  signal,
}: {
  libraries: readonly ProjectLibrary[]
  libraryTypes: ReadonlyMap<string, ProjectLibraryTypeContribution>
  warnedMissingTypeLibraryIds: Set<string>
  signal: AbortSignal
}): Promise<ProjectLibraryRealizationContribution[]> {
  const realizationGroups = await Promise.all(
    libraries.map(async (library) => {
      const readRealizations = libraryTypes.get(library.type)?.readRealizations
      if (!readRealizations) {
        if (!warnedMissingTypeLibraryIds.has(library.id)) {
          warnedMissingTypeLibraryIds.add(library.id)
          console.warn(
            `Configured project library "${library.title}" (${library.id}) has no registered "${library.type}" type handler; its projects cannot be listed.`
          )
        }
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
    })
  )

  return signal.aborted ? [] : realizationGroups.flat()
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
    let abortController: AbortController | undefined
    let disposeConfiguredProjectLibraryRealizationsEffect:
      | (() => void)
      | undefined
    let disposed = false
    let lastScannedInputs: ConfiguredProjectLibraryScanInputs | undefined

    queueMicrotask(() => {
      if (disposed) {
        return
      }

      disposeConfiguredProjectLibraryRealizationsEffect = effect(() => {
        const currentSettings = settings.value?.current.value
        const typeById = libraryTypes.value
        const invalidation = readProjectLibraryRealizationsInvalidation()
        const scanInputs: ConfiguredProjectLibraryScanInputs = {
          libraries: currentSettings
            ? projectLibrariesFromSettings(
                currentSettings.app.libraries.current
              )
            : [],
          libraryTypes: typeById,
          invalidation,
        }

        if (
          configuredProjectLibraryScanInputsAreEqual(
            lastScannedInputs,
            scanInputs
          )
        ) {
          return
        }

        lastScannedInputs = scanInputs

        abortController?.abort()
        const loadController = new AbortController()
        abortController = loadController
        realizations.value = []

        void readConfiguredProjectLibraryRealizations({
          libraries: scanInputs.libraries,
          libraryTypes: scanInputs.libraryTypes,
          warnedMissingTypeLibraryIds,
          signal: loadController.signal,
        }).then((nextRealizations) => {
          if (disposed || loadController.signal.aborted) {
            return
          }

          realizations.value = nextRealizations
        })
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
          abortController?.abort()
          disposeConfiguredProjectLibraryRealizationsEffect?.()
        },
      }),
    }
  },
  'project-libraries.configured-realizations'
)

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

const directoryProjectLibraryType = defineRegistryItemFactory((ctx) => {
  const systemIO = ctx.services.signal(systemIOService)
  const cloudSync = ctx.services.signal(cloudSyncService)
  const getWasmPromise = () =>
    ctx.valueSpecs.get(wasmPromiseValueSpec) ??
    new Error('Missing WASM promise registry value.')
  /**
   * Directory operations still notify System IO's legacy folder cache for open
   * editor/explorer flows, but Home discovery refreshes through projectLibraries.
   */
  const refreshLocalProjectRealizations = () => {
    systemIO.value?.actor.send({
      type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
    })
    invalidateProjectLibraryRealizations()
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
        refreshLocalProjectRealizations()

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
        refreshLocalProjectRealizations()

        return result
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
        refreshLocalProjectRealizations()
      },
    },
    deleteProject: {
      run: async ({ project }) => {
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
          return Promise.reject(new Error('Cloud sync is not enabled.'))
        }

        await fsZds.rm(project.localProjectPath, {
          recursive: true,
        })
        if (project.remoteProjectId) {
          await cloudSyncActions?.deleteRemoteProject(project.remoteProjectId)
        }
        refreshLocalProjectRealizations()
      },
    },
    moveProjectFrom: {
      canMoveProject: ({ project }) =>
        Boolean(project.localProjectPath && project.readWriteAccess),
      run: ({ project }) => getProjectMoveSource({ project }),
    },
    moveProjectTo: {
      run: async ({ library, source }) => {
        const result = await moveProjectIntoLocalDirectory({
          projectDirectoryPath: library.path,
          sourceProjectPath: source.localProjectPath,
          sourceProjectName: source.localProjectName,
          defaultFile: source.defaultFile,
        })
        refreshLocalProjectRealizations()

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

            const projects = await readProjectsFromProjectDirectory({
              projectDirectoryPath: library.path,
              wasmInstancePromise,
              signal,
            })
            if (!signal.aborted) {
              scheduleProjectDirectoryNameSyncFromTitles({
                projects,
                onProjectDirectoriesRenamed:
                  invalidateProjectLibraryRealizations,
              })
            }

            return projects.map((project) =>
              projectLibraryRealizationFromProject(project, library)
            )
          },
          operations,
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
  ],
  provides: [provide(settingsValueSpec, projectLibrariesSettingsContribution)],
})

export {
  invalidateProjectLibraryRealizations,
  readProjectLibraryRealizationsInvalidation,
}

export default projectLibrariesExtension
