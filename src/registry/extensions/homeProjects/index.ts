import { withHomeProjectActionStatus } from '@src/lib/homeProjectActions'
import { selectCommand } from '@src/lib/commandUtils'
import { observations as projectSessionObservations } from '@src/registry/contracts/projectSession'
import {
  extension as defineExtension,
  provide,
  contribute,
  type InputOf,
} from 'plankton'
import { computed } from '@preact/signals-core'
import {
  findHomeProjectByPath,
  getHomeProjectDisplayName,
  homeProjectDisplayNameExists,
} from '@src/lib/homeProjects'
import { separateProjectsSharingProjectId } from '@src/lib/projectIdentity'
import {
  type ProjectLibrary,
  projectLibrariesFromSettings,
} from '@src/lib/projectLibraries'
import { invalidateProjectLibraryRealizations } from '@src/lib/projectLibraries/registry/invalidation'
import { observations as commandsObservations } from '@src/registry/contracts/commands'
import { observations as fileOperationsObservations } from '@src/registry/contracts/fileOperations'
import {
  observations as homeProjectsObservations,
  type HomeProjectActionsService,
  type HomeProjectEntry,
  type HomeProjectEntryContribution,
  type HomeProjectCloneToLibraryTarget,
  homeProjectActionsService,
  homeProjectEntriesFacet,
} from '@src/registry/contracts/homeProjects'
import { projectExplorerProjectMenuItemsFacet } from '@src/registry/contracts/projectExplorer'
import {
  observations as projectLibrariesObservations,
  getProjectLibraryOperation,
  type ProjectLibraryRealization,
  type ProjectLibraryTypeOperations,
} from '@src/registry/contracts/projectLibraries'
import { observations as settingsObservations } from '@src/registry/contracts/settings'
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
const homeProjectActions = defineExtension({
  dependencies: {
    settings: settingsObservations,
    projectLibraries: projectLibrariesObservations,
    homeProjects: homeProjectsObservations,
    projectSession: projectSessionObservations,
    fileOperations: fileOperationsObservations,
  },
  key: 'home-projects.actions',
  create: ({
    settings: settingsInputs,
    projectLibraries: projectLibrariesInputs,
    homeProjects: homeProjectsInputs,
    projectSession: projectSessionInputs,
    fileOperations: fileOperationsInputs,
  }) => {
    const settings = computed(
      () => settingsInputs.settingsService.current.value
    )

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
      const libraryTypes = projectLibrariesInputs.projectLibraryTypesFacet.value
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
    const getCloneToLibraryTargets = (
      project: HomeProjectEntry
    ): HomeProjectCloneToLibraryTarget[] => {
      const projectLibraryIds = new Set(project.libraryIds ?? [])
      const libraryTypes = projectLibrariesInputs.projectLibraryTypesFacet.value
      const libraries = getConfiguredProjectLibraries()
      const targets: HomeProjectCloneToLibraryTarget[] = []
      const targetLibraryIds = new Set<string>()
      for (const sourceLibrary of getProjectLibraries(project)) {
        const cloneFrom = getProjectLibraryOperation(
          libraryTypes.get(sourceLibrary.type),
          sourceLibrary,
          'cloneProjectFrom'
        )
        if (
          !cloneFrom ||
          cloneFrom.canCloneProject?.({
            library: sourceLibrary,
            project,
          }) === false
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
          const cloneTo = getProjectLibraryOperation(
            libraryTypes.get(library.type),
            library,
            'cloneProjectTo'
          )
          if (
            !cloneTo ||
            cloneTo.canReceiveProject?.({
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
    const getCloneToLibraryTarget = (
      project: HomeProjectEntry,
      targetLibraryId: string
    ) =>
      getCloneToLibraryTargets(project).find(
        (target) => target.library.id === targetLibraryId
      )
    const serviceImpl: Omit<HomeProjectActionsService, 'pendingActions'> = {
      watchRemoteThumbnail: (id) =>
        homeProjectsInputs.homeProjectEntriesFacet.value
          .find((entry) => entry.remoteProjectId === id)
          ?.watchThumbnail?.(),
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
          project.readWriteAccess &&
            getProjectOperation(project, 'renameProject')
        ),
      canDelete: (project) =>
        Boolean(
          project.readWriteAccess &&
            getProjectOperation(project, 'deleteProject')
        ),
      canCloneToLibrary: (project) =>
        getCloneToLibraryTargets(project).length > 0,
      canReviewDuplicateRealizations: (project) => false,
      canSeparateProjectCopies: (project) =>
        Boolean(
          project.readWriteAccess &&
            project.localProjectPath &&
            project.duplicateProjectIdPaths?.length
        ),
      open: async (project) => {
        const target = getProjectOperation(project, 'openProject')
        return target?.operation.run({
          library: target.library,
          project,
        })
      },
      duplicate: async (project) => {
        const duplicateProject = getProjectOperation(
          project,
          'duplicateProject'
        )
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
            entries: homeProjectsInputs.homeProjectEntriesFacet.value,
            requestedName,
            projectId: project.id,
          })
        ) {
          const message = `Project with title "${requestedName}" already exists`
          return Promise.reject(new Error(message))
        }
        await renameProject.operation.run({
          library: renameProject.library,
          project,
          requestedName,
        })
        const session = projectSessionInputs.projectSession.current.value
        if (
          session &&
          project.localProjectPath &&
          session.project.peek()?.path === project.localProjectPath
        )
          await session.refreshProject()
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
      getCloneToLibraryTargets,
      cloneToLibrary: async (project, targetLibraryId, options) => {
        const target = getCloneToLibraryTarget(project, targetLibraryId)
        if (!target) {
          return undefined
        }
        const libraryTypes =
          projectLibrariesInputs.projectLibraryTypesFacet.value
        const cloneFrom = getProjectLibraryOperation(
          libraryTypes.get(target.sourceLibrary.type),
          target.sourceLibrary,
          'cloneProjectFrom'
        )
        const cloneTo = getProjectLibraryOperation(
          libraryTypes.get(target.library.type),
          target.library,
          'cloneProjectTo'
        )
        if (!cloneFrom || !cloneTo) {
          return undefined
        }
        const source = await cloneFrom.run({
          library: target.sourceLibrary,
          project,
          targetLibrary: target.library,
        })
        if (!source) {
          return undefined
        }
        const result = await cloneTo.run({
          library: target.library,
          sourceLibrary: target.sourceLibrary,
          project,
          source,
          requestedProjectTitle: options?.title,
        })
        toast.success(
          `Created a clone of "${getHomeProjectDisplayName(project)}" in "${target.library.title}".`
        )
        return result?.defaultFile
          ? {
              defaultFile: result.defaultFile,
              localProjectPath: result.localProjectPath,
            }
          : undefined
      },
      deleteDuplicateRealizations: async () =>
        Promise.reject(
          new Error('Historical cloud mirrors cannot be modified.')
        ),
      separateProjectCopies: async (project, keepProjectPath) => {
        if (!serviceImpl.canSeparateProjectCopies(project)) {
          return
        }
        const projectPaths = [
          project.localProjectPath,
          ...(project.duplicateProjectIdPaths ?? []),
        ].filter((projectPath): projectPath is string => Boolean(projectPath))
        await separateProjectsSharingProjectId({
          fileOperations: fileOperationsInputs.fileOperationsService.required(),
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
      items: [
        provide(
          homeProjectActionsService,
          withHomeProjectActionStatus(serviceImpl)
        ),
      ],
    }
  },
})

/**
 * Sole Home entry producer for project cards. External extensions contribute
 * local realizations, and cloudSync publishes explicit relationships through
 * its singleton service. Home derives view models from those domain models.
 */
const homeProjectEntryViewModels = defineExtension({
  dependencies: {
    projectLibraries: projectLibrariesObservations,
  },
  key: 'home-projects.view-models',
  create: ({ projectLibraries: projectLibrariesInputs }) => {
    const realizations = projectLibrariesInputs.projectLibraryRealizationsFacet
    const entries = computed(() =>
      deriveHomeProjectEntryContributions({
        realizations: realizations.value,
      })
    )
    return {
      items: [
        contribute(homeProjectEntriesFacet, () => entries.value, {
          key: 'home-projects.view-models',
        }),
      ],
    }
  },
})
const cloneProjectToLibraryProjectMenuItem = defineExtension({
  dependencies: {
    homeProjects: homeProjectsObservations,
    commands: commandsObservations,
  },
  key: 'home-projects.clone-to-library-project-menu-item',
  create: ({ homeProjects: homeProjectsInputs, commands: commandsInputs }) => {
    const findProject = (projectPath: string) =>
      findHomeProjectByPath(
        homeProjectsInputs.homeProjectEntriesFacet.value,
        projectPath
      )
    const _projectExplorerProjectMenuItemsContribution: InputOf<
      typeof projectExplorerProjectMenuItemsFacet
    > = {
      id: 'home-projects.clone-to-library-project-menu-item',
      order: 10,
      label: 'Clone project',
      dataTestId: 'project-sidebar-clone-to-library',
      isVisible: ({ projectPath }) => {
        const project = findProject(projectPath)
        const actions =
          homeProjectsInputs.homeProjectActionsService.current.value
        return Boolean(project && actions?.canCloneToLibrary(project))
      },
      onSelect: ({ projectPath }) => {
        const project = findProject(projectPath)
        const commandSystem = commandsInputs.commandSystemService.current.value
        if (!project || !commandSystem) {
          return
        }
        selectCommand(commandSystem, {
          groupId: 'projects',
          name: 'Clone project',
          argDefaultValues: {
            project: project.id,
          },
        })
      },
    }
    return {
      items: [
        contribute(
          projectExplorerProjectMenuItemsFacet,
          () => _projectExplorerProjectMenuItemsContribution,
          {
            key: 'home-projects.clone-to-library-project-menu-item',
          }
        ),
      ],
    }
  },
})
const homeProjectsExtension = [
  homeProjectActions,
  homeProjectEntryViewModels,
  cloneProjectToLibraryProjectMenuItem,
]
export default homeProjectsExtension
