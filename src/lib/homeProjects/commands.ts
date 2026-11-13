import type { ProjectOperationsService } from '@src/lib/projectSession/projectOperations'
import type { ProjectSessionService } from '@src/registry/contracts/projectSession'
import fsZds from '@src/lib/fs-zds'
import { reportRejection } from '@src/lib/trap'
import { CommandBarOverwriteWarning } from '@src/components/CommandBarOverwriteWarning'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import { MAX_PROJECT_NAME_LENGTH } from '@src/lib/constants'
import {
  getHomeProjectDeleteWarningMessage,
  getHomeProjectDisplayName,
  homeProjectDisplayNameExists,
} from '@src/lib/homeProjects'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import {
  getProjectDirectoryOptions,
  getProjectDisplayName,
  getProjectOptionNameFromDirectoryName,
} from '@src/lib/projectDisplayName'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import { getProjectDirectoryNameFromTitle } from '@src/lib/projectName'
import type { commandBarMachine } from '@src/machines/commandBarMachine'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import type {
  ProjectLibrariesService,
  ProjectLibraryCreateProjectInput,
  ProjectLibraryOperation,
} from '@src/registry/contracts/projectLibraries'
import toast from 'react-hot-toast'
import type { ContextFrom } from 'xstate'
export type ProjectsCommandSchema = {
  'Create project': {
    name: string
    libraryId?: string
  }
  'Clone project': {
    project: string
    library: string
  }
  'Import file from URL': {
    name: string
    code?: string
    method: 'newProject' | 'existingProject'
    projectName?: string
  }
}

export interface CreateProjectLibraryTarget {
  library: ProjectLibrary
  createProject: ProjectLibraryOperation<
    ProjectLibraryCreateProjectInput,
    Project | undefined
  >
}

type HomeProjectCommandAction = 'open' | 'rename' | 'delete' | 'cloneToLibrary'

interface HomeProjectCommandTarget {
  actions: HomeProjectActionsService
  project: HomeProjectEntry
}

export function createProjectCommands({
  projectOperations,
  projectSession,
  projectLibraries,
  getCurrentProjectDirectoryName,
  getCurrentProjectPath,
  getCurrentProjectLibraryId,
  getProjectLibraries,
  getCreateProjectLibraryTargets,
  getHomeProjectActions,
  getHomeProjectEntries,
}: {
  projectOperations: Pick<
    ProjectOperationsService,
    | 'projects'
    | 'createProject'
    | 'renameProject'
    | 'deleteProject'
    | 'writeFiles'
  >
  projectSession: Pick<ProjectSessionService, 'openFile'>
  projectLibraries: ProjectLibrariesService
  getCurrentProjectDirectoryName?: () => string | undefined
  getCurrentProjectPath?: () => string | undefined
  getCurrentProjectLibraryId?: () => string | undefined
  getProjectLibraries?: () => readonly ProjectLibrary[]
  getCreateProjectLibraryTargets?: () => readonly CreateProjectLibraryTarget[]
  getHomeProjectActions?: () => HomeProjectActionsService | undefined
  getHomeProjectEntries?: () => readonly HomeProjectEntry[] | undefined
}) {
  const folderSnapshot = () => projectOperations.projects.value
  const defaultProjectFolderNameSnapshot = () =>
    projectLibraries.defaultProjectName

  const currentProjectDirectoryNameSnapshot = () =>
    getCurrentProjectDirectoryName?.()
  const createProjectTargetsSnapshot = () => getCreateProjectLibraryTargets?.()
  const homeProjectActionsSnapshot = () => getHomeProjectActions?.()
  const homeProjectEntriesSnapshot = () => getHomeProjectEntries?.()

  const isCurrentHomeProject = (project: HomeProjectEntry) => {
    const currentProjectPath = getCurrentProjectPath?.()
    if (currentProjectPath) {
      return project.localProjectPath === currentProjectPath
    }

    const currentProjectDirectoryName = currentProjectDirectoryNameSnapshot()
    return Boolean(
      currentProjectDirectoryName &&
        (project.localProjectName === currentProjectDirectoryName ||
          project.name === currentProjectDirectoryName)
    )
  }

  const canUseHomeProjectAction = (
    actions: HomeProjectActionsService,
    action: HomeProjectCommandAction,
    project: HomeProjectEntry
  ) => {
    switch (action) {
      case 'open':
        return actions.canOpen(project)
      case 'rename':
        return actions.canRename(project)
      case 'delete':
        return actions.canDelete(project)
      case 'cloneToLibrary':
        return actions.canCloneToLibrary(project)
    }
  }

  const homeProjectCommandTargets = (
    action: HomeProjectCommandAction
  ): HomeProjectCommandTarget[] | undefined => {
    const actions = homeProjectActionsSnapshot()
    const entries = homeProjectEntriesSnapshot()
    if (!actions || !entries) {
      return undefined
    }

    return entries
      .filter((project) => canUseHomeProjectAction(actions, action, project))
      .map((project) => ({ actions, project }))
  }

  const selectedHomeProjectTarget = (
    value: unknown,
    action: HomeProjectCommandAction
  ) => {
    if (typeof value !== 'string') {
      return undefined
    }

    return homeProjectCommandTargets(action)?.find(
      ({ project }) => project.id === value
    )
  }

  const homeProjectOptions = (
    action: HomeProjectCommandAction
  ): CommandArgumentOption<string>[] | undefined => {
    const libraries = getProjectLibraries?.() ?? []
    return homeProjectCommandTargets(action)?.map(({ project }) => ({
      name: getHomeProjectDisplayName(project),
      description:
        libraries
          .filter((library) => project.libraryIds?.includes(library.id))
          .map((library) => library.title)
          .join(', ') || undefined,
      value: project.id,
      isCurrent: isCurrentHomeProject(project),
    }))
  }

  const projectOptions = (action: HomeProjectCommandAction) => {
    if (action === 'cloneToLibrary') {
      return homeProjectOptions(action) ?? []
    }

    return (
      homeProjectOptions(action) ??
      getProjectDirectoryOptions(folderSnapshot(), {
        defaultValue: currentProjectDirectoryNameSnapshot(),
      })
    )
  }

  const projectDisplayNameFromCommandValue = (
    value: unknown,
    action: HomeProjectCommandAction
  ) => {
    const target = selectedHomeProjectTarget(value, action)
    if (target) {
      return getHomeProjectDisplayName(target.project)
    }

    return getProjectOptionNameFromDirectoryName({
      projects: folderSnapshot(),
      directoryName: String(value ?? ''),
    })
  }

  const navigateToProjectFile = (filePath: string) => {
    if (typeof window === 'undefined') {
      return
    }

    const targetPath = `${PATHS.FILE}/${encodeURIComponent(filePath)}`
    if (window.location.hash) {
      window.location.hash = targetPath
      return
    }

    window.history.pushState(null, '', targetPath)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const selectedCreateProjectTarget = (libraryId: unknown) => {
    const createProjectTargets = createProjectTargetsSnapshot()
    if (!createProjectTargets) {
      return undefined
    }

    const requestedLibraryId =
      typeof libraryId === 'string' && libraryId.length > 0
        ? libraryId
        : undefined

    return (
      createProjectTargets.find(
        (target) => target.library.id === requestedLibraryId
      ) ?? createProjectTargets[0]
    )
  }

  const createProjectLibraryOptions = () =>
    createProjectTargetsSnapshot()?.map((target) => ({
      name: target.library.title,
      value: target.library.id,
      isCurrent: false,
    })) ?? []
  const defaultCreateProjectLibraryId = () => {
    const options = createProjectLibraryOptions()
    const currentLibraryId = getCurrentProjectLibraryId?.()
    return (
      options.find((option) => option.value === currentLibraryId)?.value ??
      options[0]?.value ??
      ''
    )
  }

  const cloneToLibraryTargets = (projectId: unknown) => {
    const target = selectedHomeProjectTarget(projectId, 'cloneToLibrary')
    if (!target) {
      return []
    }

    return target.actions
      .getCloneToLibraryTargets(target.project)
      .map((cloneTarget) => ({
        actions: target.actions,
        project: target.project,
        cloneTarget,
      }))
  }

  const selectedCloneToLibraryTarget = ({
    projectId,
    libraryId,
  }: {
    projectId: unknown
    libraryId: unknown
  }) => {
    if (typeof libraryId !== 'string') {
      return undefined
    }

    return cloneToLibraryTargets(projectId).find(
      ({ cloneTarget }) => cloneTarget.library.id === libraryId
    )
  }

  const cloneToLibraryOptions = ({
    argumentsToSubmit,
  }: {
    argumentsToSubmit: Record<string, unknown>
  }) =>
    cloneToLibraryTargets(argumentsToSubmit.project).map(({ cloneTarget }) => ({
      name: cloneTarget.library.title,
      value: cloneTarget.library.id,
      isCurrent: false,
    }))

  const defaultCloneToLibraryId = (
    context: ContextFrom<typeof commandBarMachine>
  ) => cloneToLibraryOptions(context)[0]?.value ?? ''
  const hasSelectedCloneToLibraryTarget = ({
    argumentsToSubmit,
  }: {
    argumentsToSubmit: Record<string, unknown>
  }) =>
    Boolean(
      selectedCloneToLibraryTarget({
        projectId: argumentsToSubmit.project,
        libraryId: argumentsToSubmit.library,
      })
    )

  const openProjectCommand: Command = {
    scopes: GLOBAL_COMMAND_SCOPES,
    icon: 'folder',
    name: 'Open project',
    displayName: `Open project`,
    description: 'Open a project',
    groupId: 'projects',
    needsReview: false,
    onSubmit: (record) => {
      if (record) {
        const target = selectedHomeProjectTarget(record.name, 'open')
        if (target) {
          return target.actions.open(target.project).then((result) => {
            if (result?.defaultFile) {
              navigateToProjectFile(result.defaultFile)
            }
          })
        }

        projectSession
          .openFile(
            fsZds.join(projectLibraries.projectDirectoryPath, record.name)
          )
          .catch(reportRejection)
      }
    },
    args: {
      name: {
        required: true,
        inputType: 'options',
        options: () => projectOptions('open'),
      },
    },
  }

  const createProjectCommand: Command = {
    scopes: GLOBAL_COMMAND_SCOPES,
    icon: 'folder',
    name: 'Create project',
    displayName: `Create project`,
    description: 'Create a project',
    groupId: 'projects',
    needsReview: false,
    onSubmit: (record) => {
      if (record) {
        const target = selectedCreateProjectTarget(record.libraryId)
        if (getCreateProjectLibraryTargets && !target) {
          toast.error(
            'Add a writable project library before creating a project.'
          )
          return
        }

        const requestedProjectTitle =
          String(record.name ?? '').trim() || defaultProjectFolderNameSnapshot()
        const requestedProjectName = getProjectDirectoryNameFromTitle(
          requestedProjectTitle,
          defaultProjectFolderNameSnapshot()
        )
        if (requestedProjectName.length > MAX_PROJECT_NAME_LENGTH) {
          toast.error(
            `Project name is too long, must be less than or equal to ${MAX_PROJECT_NAME_LENGTH} characters.`
          )
          return
        }

        if (target) {
          return Promise.resolve(
            target.createProject.run({
              library: target.library,
              requestedProjectName,
              requestedProjectTitle,
            })
          ).then((project) => {
            if (project?.default_file) {
              navigateToProjectFile(project.default_file)
            }
          })
        }

        projectOperations
          .createProject({
            directory: projectLibraries.projectDirectoryPath,
            name: requestedProjectName,
            title: requestedProjectTitle,
          })
          .then((project) =>
            projectSession.openFile(project.default_file, {
              projectPath: project.path,
            })
          )
          .catch(reportRejection)
      }
    },
    args: {
      name: {
        displayName: 'Title',
        required: true,
        inputType: 'string',
        defaultValue: defaultProjectFolderNameSnapshot,
      },
      libraryId: {
        displayName: 'Library',
        required: () => createProjectLibraryOptions().length > 1,
        prepopulate: true,
        hidden: () => createProjectLibraryOptions().length <= 1,
        inputType: 'options',
        options: createProjectLibraryOptions,
        defaultValue: defaultCreateProjectLibraryId,
        valueSummary(value) {
          return (
            createProjectLibraryOptions().find(
              (option) => option.value === value
            )?.name ?? 'Library'
          )
        },
      },
    },
  }

  const cloneToLibraryCommand: Command = {
    scopes: GLOBAL_COMMAND_SCOPES,
    icon: 'folder',
    name: 'Clone project',
    displayName: 'Clone project',
    description: 'Create an independent project in another library',
    groupId: 'projects',
    needsReview: true,
    onSubmit: (record) => {
      if (!record) {
        return
      }

      const target = selectedCloneToLibraryTarget({
        projectId: record.project,
        libraryId: record.library,
      })
      if (!target) {
        toast.error('Select a library that can receive this project.')
        return
      }

      return target.actions
        .cloneToLibrary(target.project, target.cloneTarget.library.id)
        .then((result) => {
          if (isCurrentHomeProject(target.project) && result?.defaultFile) {
            navigateToProjectFile(result.defaultFile)
          }
        })
    },
    reviewMessage: ({ argumentsToSubmit }) => {
      const target = selectedCloneToLibraryTarget({
        projectId: argumentsToSubmit.project,
        libraryId: argumentsToSubmit.library,
      })
      const projectName = projectDisplayNameFromCommandValue(
        argumentsToSubmit.project,
        'cloneToLibrary'
      )
      const sourceLibrary = target?.cloneTarget.sourceLibrary
      const targetLibrary = target?.cloneTarget.library
      const differentType =
        sourceLibrary &&
        targetLibrary &&
        sourceLibrary.type !== targetLibrary.type

      return CommandBarOverwriteWarning({
        heading: differentType
          ? 'Create a project in a different library type?'
          : 'Clone project?',
        message: target
          ? `Create a new project in "${targetLibrary?.title}" from "${projectName}". The original project in "${sourceLibrary?.title}" will be kept.`
          : `Create a new project from "${projectName}" in another library. The original will be kept.`,
      })
    },
    args: {
      project: {
        inputType: 'options',
        required: true,
        hidden: hasSelectedCloneToLibraryTarget,
        options: () => projectOptions('cloneToLibrary'),
      },
      library: {
        inputType: 'options',
        required: true,
        prepopulate: true,
        hidden: hasSelectedCloneToLibraryTarget,
        options: cloneToLibraryOptions,
        defaultValue: defaultCloneToLibraryId,
      },
    },
  }

  const deleteProjectCommand: Command = {
    scopes: GLOBAL_COMMAND_SCOPES,
    icon: 'folder',
    name: 'Delete project',
    displayName: `Delete project`,
    description: 'Delete a project',
    groupId: 'projects',
    needsReview: true,
    onSubmit: (record) => {
      if (record) {
        const target = selectedHomeProjectTarget(record.name, 'delete')
        if (target) {
          return target.actions.delete(target.project)
        }

        projectOperations
          .deleteProject(
            fsZds.join(projectLibraries.projectDirectoryPath, record.name)
          )
          .then(() => projectLibraries.refreshProjects())
          .catch(reportRejection)
      }
    },
    reviewMessage: ({ argumentsToSubmit }) => {
      const target = selectedHomeProjectTarget(argumentsToSubmit.name, 'delete')
      const projectDisplayName = projectDisplayNameFromCommandValue(
        argumentsToSubmit.name,
        'delete'
      )

      return CommandBarOverwriteWarning({
        heading: 'Are you sure you want to delete?',
        message: target
          ? getHomeProjectDeleteWarningMessage(
              target.project,
              projectDisplayName
            )
          : `This will permanently delete the project "${projectDisplayName}" and all its contents.`,
      })
    },
    args: {
      name: {
        inputType: 'options',
        required: true,
        options: () => projectOptions('delete'),
      },
    },
  }

  const renameProjectCommand: Command = {
    scopes: GLOBAL_COMMAND_SCOPES,
    icon: 'folder',
    name: 'Rename project',
    displayName: `Rename project`,
    description: 'Rename a project',
    groupId: 'projects',
    needsReview: true,
    onSubmit: (record) => {
      if (record) {
        const target = selectedHomeProjectTarget(record.oldName, 'rename')
        if (target) {
          return target.actions.rename(target.project, record.newName)
        }

        // Only redirect back to the project when not on the home page
        const hash = window.location.hash
        const pathname = hash
          ? hash.replace(/^#/, '')
          : window.location.pathname
        const isOnHomePage = pathname.startsWith(PATHS.HOME)
        const path = fsZds.join(
          projectLibraries.projectDirectoryPath,
          record.oldName
        )
        projectOperations
          .renameProject(path, record.newName)
          .then(async () => {
            await projectLibraries.refreshProjects()
            if (!isOnHomePage)
              await projectSession.openFile(path, { projectPath: path })
          })
          .catch(reportRejection)
      }
    },
    args: {
      oldName: {
        displayName: 'Project',
        description: 'Project to retitle.',
        inputType: 'options',
        required: true,
        options: () => projectOptions('rename'),
      },
      newName: {
        displayName: 'New title',
        inputType: 'string',
        required: true,
        validation: async ({ context, data }) => {
          const projectName = context.argumentsToSubmit.oldName
          const requestedName = data.newName
          const target = selectedHomeProjectTarget(projectName, 'rename')
          const titleExists = target
            ? homeProjectDisplayNameExists({
                entries: homeProjectEntriesSnapshot(),
                requestedName,
                projectId: target.project.id,
              })
            : folderSnapshot()?.some(
                (project) =>
                  project.name !== projectName &&
                  getProjectDisplayName(project) === requestedName
              )

          return titleExists
            ? `Project with title "${requestedName}" already exists`
            : true
        },
        defaultValue: (context: ContextFrom<typeof commandBarMachine>) => {
          const projectDirectoryName = context.argumentsToSubmit.oldName as
            | string
            | undefined
          const target = selectedHomeProjectTarget(
            projectDirectoryName,
            'rename'
          )
          if (target) {
            return getHomeProjectDisplayName(target.project)
          }

          const folder = folderSnapshot()?.find(
            (item) => item.name === projectDirectoryName
          )
          return folder
            ? getProjectDisplayName(folder)
            : projectDirectoryName || defaultProjectFolderNameSnapshot()
        },
      },
    },
  }

  const importFileFromURL: Command = {
    scopes: GLOBAL_COMMAND_SCOPES,
    name: 'Import file from URL',
    hideFromSearch: true,
    groupId: 'projects',
    icon: 'file',
    description: 'Create a file',
    needsReview: true,
    onSubmit: (record) => {
      if (record) {
        const root = fsZds.join(
          projectLibraries.projectDirectoryPath,
          record.projectName || projectLibraries.defaultProjectName
        )
        projectOperations
          .writeFiles(root, [
            { path: record.name, contents: record.code ?? '' },
          ])
          .then(async (paths) => {
            await projectLibraries.refreshProjects()
            await projectSession.openFile(paths[0], { projectPath: root })
          })
          .catch(reportRejection)
      }
    },
    args: {
      method: {
        inputType: 'options',
        required: true,
        skip: true,
        options: isDesktop()
          ? [
              { name: 'New project', value: 'newProject' },
              { name: 'Existing project', value: 'existingProject' },
            ]
          : [{ name: 'Overwrite', value: 'existingProject' }],
        valueSummary(value) {
          return isDesktop()
            ? value === 'newProject'
              ? 'New project'
              : 'Existing project'
            : 'Overwrite'
        },
      },
      // TODO: We can't get the currently-opened project to auto-populate here because
      // it's not available on projectMachine, but lower in fileMachine. Unify these.
      projectName: {
        inputType: 'options',
        required: (commandsContext) =>
          isDesktop() &&
          commandsContext.argumentsToSubmit.method === 'existingProject',
        skip: true,
        options: (_, _context) => {
          return getProjectDirectoryOptions(folderSnapshot(), {
            defaultValue: currentProjectDirectoryNameSnapshot(),
          })
        },
      },
      name: {
        inputType: 'string',
        required: isDesktop(),
        skip: true,
      },
      code: {
        inputType: 'text',
        required: true,
        skip: true,
        valueSummary(value) {
          const lineCount = value?.trim().split('\n').length
          return `${lineCount} line${lineCount === 1 ? '' : 's'}`
        },
      },
    },
    reviewMessage(commandBarContext) {
      return isDesktop()
        ? `Will add the contents from URL to a new ${
            commandBarContext.argumentsToSubmit.method === 'newProject'
              ? 'project with file main.kcl'
              : `file within the project "${commandBarContext.argumentsToSubmit.projectName}"`
          } named "${
            commandBarContext.argumentsToSubmit.name
          }", and set default units to "${
            commandBarContext.argumentsToSubmit.units
          }".`
        : `Will overwrite the contents of the current file with the contents from the URL.`
    },
  }

  return [
    openProjectCommand,
    createProjectCommand,
    cloneToLibraryCommand,
    deleteProjectCommand,
    renameProjectCommand,
    importFileFromURL,
  ]
}
