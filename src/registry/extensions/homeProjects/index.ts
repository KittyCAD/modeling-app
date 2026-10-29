import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'

import { computed } from '@preact/signals-core'

import {
  getHomeProjectDisplayName,
  homeProjectDisplayNameExists,
} from '@src/lib/homeProjects'

import { separateProjectsSharingProjectId } from '@src/lib/projectIdentity'

import {
  type ProjectLibrary,
  projectLibrariesFromSettings,
} from '@src/lib/projectLibraries'

import { invalidateProjectLibraryRealizations } from '@src/lib/projectLibraries/registry/invalidation'

import { commandSystemService } from '@src/registry/contracts/commands'

import {
  cloudStorageService,
  fileOperationsService,
} from '@src/registry/contracts/fileOperations'

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
  type ProjectLibraryRealization,
  type ProjectLibraryTypeOperations,
  projectLibraryRealizationsValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'

import { settingsService } from '@src/registry/contracts/settings'

import toast from 'react-hot-toast'

import { NIL as uuidNIL } from 'uuid'

function duplicateProjectIdPathsByLocalPath(
  realizations: readonly ProjectLibraryRealization[]
) {
  const projectPathsById = new Map<string, Set<string>>()

  for (const realization of realizations) {
    if (!realization.projectId || realization.projectId === uuidNIL) {
      continue
    }
    const projectPaths =
      projectPathsById.get(realization.projectId) ?? new Set()
    projectPaths.add(realization.localProjectPath)
    projectPathsById.set(realization.projectId, projectPaths)
  }

  const duplicatePathsByLocalPath = new Map<string, string[]>()
  for (const projectPathSet of projectPathsById.values()) {
    if (projectPathSet.size < 2) {
      continue
    }
    const projectPaths = Array.from(projectPathSet)
    for (const projectPath of projectPaths) {
      duplicatePathsByLocalPath.set(
        projectPath,
        projectPaths.filter((candidatePath) => candidatePath !== projectPath)
      )
    }
  }

  return duplicatePathsByLocalPath
}

export function deriveHomeProjectEntryContributions({
  realizations,
}: {
  realizations: readonly ProjectLibraryRealization[]
}): HomeProjectEntryContribution[] {
  const duplicatePaths = duplicateProjectIdPathsByLocalPath(realizations)
  return realizations.map((project) => ({
    duplicateProjectIdPaths: duplicatePaths.get(project.localProjectPath),
    id: `local:${project.localProjectPath}`,
    source: 'local',
    status: 'local',
    libraryIds: project.libraryIds,
    name: project.name,
    title: project.title,
    localProjectPath: project.localProjectPath,
    localProjectName: project.localProjectName,
    defaultFile: project.defaultFile,
    modified: project.modified,
    kclFileCount: project.kclFileCount,
    directoryCount: project.directoryCount,
    readWriteAccess: project.readWriteAccess,
    thumbnail: project.thumbnail,
    deleteRemoteOnDelete: false,
  }))
}
const homeProjectActions = defineRegistryItemFactory((ctx) => {
  const settings = ctx.services.signal(settingsService)

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
    watchRemoteThumbnail: () => undefined,
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
    canReviewDuplicateRealizations: (project) => false,
    canSeparateProjectCopies: (project) =>
      Boolean(
        project.readWriteAccess &&
          project.localProjectPath &&
          project.duplicateProjectIdPaths?.length
      ),
    open: async (project) => {
      const target = getProjectOperation(project, 'openProject')
      return target?.operation.run({ library: target.library, project })
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
    rename: async (project, requestedName, options) => {
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
        if (options?.notify !== false) {
          toast.error(message)
        }
        return Promise.reject(new Error(message))
      }

      await renameProject.operation.run({
        library: renameProject.library,
        project,
        requestedName,
      })
      if (options?.notify !== false) {
        toast.success(
          `Successfully renamed "${getHomeProjectDisplayName(project)}" to "${requestedName}"`
        )
      }
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
            localProjectPath: result.localProjectPath,
          }
        : undefined
    },
    deleteDuplicateRealizations: async () =>
      Promise.reject(new Error('Historical cloud mirrors cannot be modified.')),
    separateProjectCopies: async (project, keepProjectPath) => {
      if (!serviceImpl.canSeparateProjectCopies(project)) {
        return
      }

      const projectPaths = [
        project.localProjectPath,
        ...(project.duplicateProjectIdPaths ?? []),
      ].filter((projectPath): projectPath is string => Boolean(projectPath))
      await separateProjectsSharingProjectId({
        fileOperations: ctx.services.get(fileOperationsService),
        projectPaths,
        keepProjectPath,
      })
      invalidateProjectLibraryRealizations()
      toast.success(
        keepProjectPath
          ? 'Separated project copies. The selected project kept its Zookeeper history.'
          : 'Separated project copies and cleared their Zookeeper history.'
      )
    },
  }

  return {
    id: 'home-projects.actions',
    providesServices: [provideService(homeProjectActionsService, serviceImpl)],
  }
}, 'home-projects.actions')

/**
 * Sole Home entry producer for project cards. External extensions contribute
 * local realizations, and cloudSync publishes explicit relationships through
 * its singleton service. Home derives view models from those domain models.
 */
const homeProjectEntryViewModels = defineRegistryItemFactory((ctx) => {
  const realizations = ctx.valueSpecs.signal(
    projectLibraryRealizationsValueSpec
  )
  const entries = computed(() =>
    deriveHomeProjectEntryContributions({ realizations: realizations.value })
  )
  return {
    id: 'home-projects.view-models',
    provides: [
      provide(homeProjectEntriesValueSpec, entries, {
        key: 'home-projects.view-models',
      }),
    ],
  }
}, 'home-projects.view-models')
const moveProjectToLibraryProjectMenuItem = defineRegistryItemFactory((ctx) => {
  const findProject = (projectPath: string) =>
    ctx.valueSpecs
      .get(homeProjectEntriesValueSpec)
      .find(
        (entry) =>
          entry.localProjectPath === projectPath ||
          (entry.remoteProjectId &&
            ctx.services
              .get(cloudStorageService)
              .pathFor(entry.remoteProjectId) === projectPath)
      )

  return {
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
