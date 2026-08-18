import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { getCloudProjectLibraryMaterializationDirectoryPath } from '@src/lib/cloudSync/paths'
import { getProjectInfo } from '@src/lib/desktop'
import { getHomeProjectDisplayName } from '@src/lib/homeProjects'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  type ProjectLibrary,
  projectLibrariesFromSettings,
} from '@src/lib/projectLibraries'
import { invalidateProjectLibraryRealizations } from '@src/lib/projectLibraries/registry/invalidation'
import {
  type CloudProjectRelationship,
  type CloudProjectRelationshipRealization,
  cloudProjectRelationshipsService,
  cloudSyncService,
} from '@src/registry/contracts/cloudSync'
import { commandSystemService } from '@src/registry/contracts/commands'
import {
  type HomeProjectActionsService,
  type HomeProjectDuplicateRealization,
  type HomeProjectEntry,
  type HomeProjectEntryContribution,
  type HomeProjectMoveToLibraryTarget,
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import { projectExplorerProjectMenuItemsValueSpec } from '@src/registry/contracts/projectExplorer'
import {
  getProjectLibraryOperation,
  type ProjectLibraryRealization,
  type ProjectLibraryTypeOperations,
  projectLibraryRealizationsValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { settingsService } from '@src/registry/contracts/settings'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import toast from 'react-hot-toast'

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

function homeProjectStatusFromRealization(
  realization: ProjectLibraryRealization
): HomeProjectEntryContribution['status'] {
  if (realization.conflict) {
    return 'conflicted'
  }
  if (realization.cloudProjectId) {
    return 'synced'
  }
  return 'local'
}

/**
 * Delete semantics come from the operation-owning library type, not Home's
 * identity model. Cloud-library realizations delete the remote project; directory
 * realizations with cloud metadata delete only the local folder.
 */
function realizationDeletesRemoteOnDelete(
  realization: ProjectLibraryRealization | undefined
) {
  return Boolean(
    realization?.cloudProjectId &&
      realization.libraryRefs.some(
        (library) => library.type === CLOUD_PROJECT_LIBRARY_TYPE
      )
  )
}

/**
 * Converts a local realization that is not part of a cloud relationship into a
 * Home card. This path must stay local-only; cloud ID observations on the
 * realization are not enough for Home to infer relationship identity.
 */
function homeProjectEntryFromRealization(
  realization: ProjectLibraryRealization
): HomeProjectEntryContribution {
  return {
    source: 'local',
    status: homeProjectStatusFromRealization(realization),
    libraryIds: realization.libraryIds,
    name: realization.name,
    title: realization.title,
    localProjectPath: realization.localProjectPath,
    localProjectName: realization.localProjectName,
    remoteProjectId: realization.cloudProjectId,
    deleteRemoteOnDelete: realizationDeletesRemoteOnDelete(realization),
    modified: realization.modified,
    defaultFile: realization.defaultFile,
    kclFileCount: realization.kclFileCount,
    directoryCount: realization.directoryCount,
    readWriteAccess: realization.readWriteAccess,
    thumbnail: realization.thumbnail,
    conflict: realization.conflict,
    syncFailure: realization.syncFailure,
  }
}

/** Local library membership is copied from relationship realizations. */
function libraryIdsFromRelationship(
  relationship: CloudProjectRelationship
): readonly string[] {
  const libraryIds = relationship.localRealizations.flatMap(
    ({ realization }) => realization.libraryIds
  )
  return Array.from(new Set(libraryIds))
}

function homeProjectNameFromCloudRelationship({
  canonical,
  relationship,
}: {
  canonical?: ProjectLibraryRealization
  relationship: CloudProjectRelationship
}) {
  return (
    canonical?.name ??
    relationship.remoteProject?.title ??
    relationship.remoteProjectId
  )
}

function homeProjectTitleFromCloudRelationship({
  canonical,
  relationship,
}: {
  canonical?: ProjectLibraryRealization
  relationship: CloudProjectRelationship
}) {
  return canonical?.title ?? relationship.remoteProject?.title
}

function homeProjectDuplicateRealizationFromRelationship(
  relationship: CloudProjectRelationship,
  duplicate: CloudProjectRelationshipRealization
): HomeProjectDuplicateRealization {
  return {
    remoteProjectId: relationship.remoteProjectId,
    canonicalProjectPath:
      relationship.canonicalRealization?.realization.localProjectPath,
    localProjectPath: duplicate.realization.localProjectPath,
    localProjectName: duplicate.realization.localProjectName,
    title: duplicate.realization.title,
    libraryIds: duplicate.realization.libraryIds,
    libraryTitles: duplicate.realization.libraryRefs.map(
      (library) => library.title
    ),
    duplicateRisk: duplicate.duplicateRisk,
    autoCleanupEligible: duplicate.autoCleanupEligible,
  }
}

/**
 * Converts one explicit cloud relationship into one Home card. Home can choose
 * display fallbacks, badges, and actions from the relationship, but it must not
 * merge arbitrary provider entries or decide which local folders are duplicates.
 */
function homeProjectEntryFromCloudRelationship(
  relationship: CloudProjectRelationship
): HomeProjectEntryContribution {
  const canonical = relationship.canonicalRealization?.realization
  const duplicateRealizations = relationship.duplicateRealizations.map(
    (duplicate) =>
      homeProjectDuplicateRealizationFromRelationship(relationship, duplicate)
  )
  const relationshipLibraryIds = libraryIdsFromRelationship(relationship)
  const source = canonical ? 'local' : 'remote'
  const thumbnail = canonical?.thumbnail
    ? canonical.thumbnail
    : relationship.remoteThumbnailUrl
      ? {
          type: 'remote' as const,
          url: relationship.remoteThumbnailUrl,
        }
      : undefined

  return {
    id: relationship.id,
    cloudRelationshipId: relationship.id,
    source,
    status: relationship.conflict
      ? 'conflicted'
      : canonical
        ? 'synced'
        : 'cloud-only',
    libraryIds:
      relationshipLibraryIds.length > 0
        ? relationshipLibraryIds
        : [PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
    name: homeProjectNameFromCloudRelationship({ canonical, relationship }),
    title: homeProjectTitleFromCloudRelationship({ canonical, relationship }),
    localProjectPath: canonical?.localProjectPath,
    localProjectName: canonical?.localProjectName,
    remoteProjectId: relationship.remoteProjectId,
    deleteRemoteOnDelete: Boolean(
      relationship.remoteProjectId &&
        (!canonical || realizationDeletesRemoteOnDelete(canonical))
    ),
    modified: relationship.modified ?? canonical?.modified,
    defaultFile: canonical?.defaultFile,
    kclFileCount: canonical?.kclFileCount,
    directoryCount: canonical?.directoryCount,
    readWriteAccess: canonical?.readWriteAccess ?? true,
    thumbnail,
    conflict: relationship.conflict ?? canonical?.conflict,
    syncFailure: relationship.syncFailure ?? canonical?.syncFailure,
    duplicateRealizations:
      duplicateRealizations.length > 0 ? duplicateRealizations : undefined,
  }
}

/**
 * Builds Home project cards from explicit inputs:
 * - one card for each cloud relationship;
 * - one local-only card for each realization not claimed by a relationship.
 */
export function deriveHomeProjectEntryContributions({
  realizations,
  cloudRelationships,
}: {
  realizations: readonly ProjectLibraryRealization[]
  cloudRelationships: readonly CloudProjectRelationship[]
}): HomeProjectEntryContribution[] {
  const relationshipLocalPaths = new Set(
    cloudRelationships.flatMap((relationship) =>
      relationship.localRealizations.map(
        ({ realization }) => realization.localProjectPath
      )
    )
  )
  const relationshipEntries = cloudRelationships.map(
    homeProjectEntryFromCloudRelationship
  )
  const localOnlyEntries = realizations
    .filter(
      (realization) => !relationshipLocalPaths.has(realization.localProjectPath)
    )
    .map(homeProjectEntryFromRealization)

  return [...relationshipEntries, ...localOnlyEntries]
}

/**
 * UI adapter for Home project commands. Storage behavior stays with project
 * library operations, and cloud duplicate cleanup stays with cloudSync.
 */
const homeProjectActions = defineRegistryItemFactory((ctx) => {
  const settings = ctx.services.signal(settingsService)
  const cloudSync = ctx.services.signal(cloudSyncService)

  const getWasmPromise = () =>
    ctx.valueSpecs.get(wasmPromiseValueSpec) ??
    new Error('Missing WASM promise registry value.')

  /**
   * Selects the first configured library containing the Home card that supports
   * the requested operation. Multi-library membership is explicit on the card.
   */
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
    canReviewDuplicateRealizations: (project) =>
      Boolean(project.duplicateRealizations?.length),
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

      if (!openProject) {
        return undefined
      }

      const targetProjectDirectoryPath =
        await getCloudProjectLibraryMaterializationDirectoryPath(
          openProject.library
        )
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
    deleteDuplicateRealizations: async (project, duplicateProjectPaths) => {
      if (!project.remoteProjectId || duplicateProjectPaths.length === 0) {
        return
      }

      await cloudSync.value?.deleteDuplicateProjectRealizations({
        remoteProjectId: project.remoteProjectId,
        canonicalProjectPath: project.localProjectPath,
        duplicateProjectPaths,
      })
      invalidateProjectLibraryRealizations()
      toast.success('Deleted duplicate project copies.')
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

/**
 * Sole Home entry producer for project cards. External extensions contribute
 * local realizations, and cloudSync publishes explicit relationships through
 * its singleton service. Home derives view models from those domain models.
 */
const homeProjectEntryViewModels = defineRegistryItemFactory((ctx) => {
  const projectLibraryRealizations = ctx.valueSpecs.signal(
    projectLibraryRealizationsValueSpec
  )
  const cloudProjectRelationships = ctx.services.signal(
    cloudProjectRelationshipsService
  )
  const entries = computed(() =>
    deriveHomeProjectEntryContributions({
      realizations: projectLibraryRealizations.value,
      cloudRelationships:
        cloudProjectRelationships.value?.relationships.value ?? [],
    })
  )

  return {
    item: defineRuntimeRegistryItem({
      id: 'home-projects.view-models',
      provides: [
        provide(homeProjectEntriesValueSpec, entries, {
          key: 'home-projects.view-models',
        }),
      ],
    }),
  }
}, 'home-projects.view-models')

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
            label: 'Move project',
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
                  name: 'Move project',
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
    homeProjectActions,
    homeProjectEntryViewModels,
    moveProjectToLibraryProjectMenuItem,
  ],
})

export default homeProjectsExtension
