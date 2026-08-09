import { CommandBarOverwriteWarning } from '@src/components/CommandBarOverwriteWarning'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import { MAX_PROJECT_NAME_LENGTH } from '@src/lib/constants'
import {
  getHomeProjectDeleteWarningMessage,
  getHomeProjectDisplayName,
} from '@src/lib/homeProjects'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import fsZds from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import { getProjectDirectoryNameFromTitle } from '@src/lib/projectName'
import type { commandBarMachine } from '@src/machines/commandBarMachine'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'
import type {
  ProjectLibraryCreateProjectInput,
  ProjectLibraryOperation,
} from '@src/registry/contracts/projectLibraries'
import type { ProjectSessionService } from '@src/registry/contracts/projectSession'
import toast from 'react-hot-toast'
import type { ContextFrom } from 'xstate'
export type ProjectsCommandSchema = {
  'Create project': {
    name: string
    libraryId?: string
  }
  'Move project': {
    project: string
    library: string
  }
  'Duplicate project': {
    project: string
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

type HomeProjectCommandAction = 'open' | 'rename' | 'delete' | 'moveToLibrary'
type HomeProjectCommandActionWithDuplicate =
  | HomeProjectCommandAction
  | 'duplicate'

interface HomeProjectCommandTarget {
  actions: HomeProjectActionsService
  project: HomeProjectEntry
}

function defaultEnableProjectDirectoryCommands() {
  return typeof window !== 'undefined' && Boolean(window.electron)
}

function isAbsoluteProjectPath(value: string) {
  return value.startsWith(fsZds.sep) || /^[A-Za-z]:[\\/]/.test(value)
}

export function createProjectCommands({
  enableProjectDirectoryCommands = defaultEnableProjectDirectoryCommands(),
  getDefaultProjectFolderName,
  getCurrentProjectDirectoryName,
  getCurrentProjectLibraryId,
  getCreateProjectLibraryTargets,
  getHomeProjectActions,
  getHomeProjectEntries,
  getProjectSession,
}: {
  enableProjectDirectoryCommands?: boolean
  getDefaultProjectFolderName?: () => string | undefined
  getCurrentProjectDirectoryName?: () => string | undefined
  getCurrentProjectLibraryId?: () => string | undefined
  getCreateProjectLibraryTargets?: () => readonly CreateProjectLibraryTarget[]
  getHomeProjectActions?: () => HomeProjectActionsService | undefined
  getHomeProjectEntries?: () => readonly HomeProjectEntry[] | undefined
  getProjectSession?: () => ProjectSessionService | undefined
}) {
  const defaultProjectFolderNameSnapshot = () =>
    getDefaultProjectFolderName?.() ?? 'project'

  const currentProjectDirectoryNameSnapshot = () =>
    getCurrentProjectDirectoryName?.()
  const createProjectTargetsSnapshot = () => getCreateProjectLibraryTargets?.()
  const homeProjectActionsSnapshot = () => getHomeProjectActions?.()
  const homeProjectEntriesSnapshot = () => getHomeProjectEntries?.()
  const projectSessionSnapshot = () => getProjectSession?.()

  const isCurrentHomeProject = (project: HomeProjectEntry) => {
    const currentProjectDirectoryName = currentProjectDirectoryNameSnapshot()
    return Boolean(
      currentProjectDirectoryName &&
        (project.localProjectName === currentProjectDirectoryName ||
          project.name === currentProjectDirectoryName)
    )
  }

  const canUseHomeProjectAction = (
    actions: HomeProjectActionsService,
    action: HomeProjectCommandActionWithDuplicate,
    project: HomeProjectEntry
  ) => {
    switch (action) {
      case 'open':
        return actions.canOpen(project)
      case 'duplicate':
        return actions.canDuplicate(project)
      case 'rename':
        return actions.canRename(project)
      case 'delete':
        return actions.canDelete(project)
      case 'moveToLibrary':
        return actions.canMoveToLibrary(project)
    }
  }

  const homeProjectCommandTargets = (
    action: HomeProjectCommandActionWithDuplicate
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
    action: HomeProjectCommandActionWithDuplicate
  ) => {
    if (typeof value !== 'string') {
      return undefined
    }

    return homeProjectCommandTargets(action)?.find(
      ({ project }) =>
        project.id === value ||
        project.localProjectName === value ||
        project.localProjectPath === value ||
        project.name === value
    )
  }

  const homeProjectOptions = (
    action: HomeProjectCommandActionWithDuplicate
  ): CommandArgumentOption<string>[] | undefined =>
    homeProjectCommandTargets(action)?.map(({ project }) => ({
      name: getHomeProjectDisplayName(project),
      value: project.id,
      isCurrent: isCurrentHomeProject(project),
    }))

  const projectOptions = (action: HomeProjectCommandActionWithDuplicate) => {
    const options = homeProjectOptions(action)
    if (options) {
      return options
    }

    return []
  }

  const projectDisplayNameFromCommandValue = (
    value: unknown,
    action: HomeProjectCommandAction
  ) => {
    const target = selectedHomeProjectTarget(value, action)
    if (target) {
      return getHomeProjectDisplayName(target.project)
    }

    return String(value ?? '')
  }

  const importProjectOptions = () =>
    (homeProjectEntriesSnapshot() ?? [])
      .filter(
        (project) =>
          project.readWriteAccess &&
          Boolean(project.localProjectName || project.name)
      )
      .map((project) => ({
        name: getHomeProjectDisplayName(project),
        value: project.id,
        isCurrent: isCurrentHomeProject(project),
      }))

  const defaultImportProjectId = () => {
    const currentProjectDirectoryName = currentProjectDirectoryNameSnapshot()
    return (
      (homeProjectEntriesSnapshot() ?? []).find(
        (project) =>
          project.localProjectName === currentProjectDirectoryName ||
          project.name === currentProjectDirectoryName
      )?.id ??
      currentProjectDirectoryName ??
      ''
    )
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

  const moveToLibraryTargets = (projectId: unknown) => {
    const target = selectedHomeProjectTarget(projectId, 'moveToLibrary')
    if (!target) {
      return []
    }

    return target.actions
      .getMoveToLibraryTargets(target.project)
      .map((moveTarget) => ({
        actions: target.actions,
        project: target.project,
        moveTarget,
      }))
  }

  const selectedMoveToLibraryTarget = ({
    projectId,
    libraryId,
  }: {
    projectId: unknown
    libraryId: unknown
  }) => {
    if (typeof libraryId !== 'string') {
      return undefined
    }

    return moveToLibraryTargets(projectId).find(
      ({ moveTarget }) => moveTarget.library.id === libraryId
    )
  }

  const moveToLibraryOptions = ({
    argumentsToSubmit,
  }: {
    argumentsToSubmit: Record<string, unknown>
  }) =>
    moveToLibraryTargets(argumentsToSubmit.project).map(({ moveTarget }) => ({
      name: moveTarget.library.title,
      value: moveTarget.library.id,
      isCurrent: false,
    }))

  const defaultMoveToLibraryId = (
    context: ContextFrom<typeof commandBarMachine>
  ) => moveToLibraryOptions(context)[0]?.value ?? ''
  const hasSelectedMoveToLibraryTarget = ({
    argumentsToSubmit,
  }: {
    argumentsToSubmit: Record<string, unknown>
  }) =>
    Boolean(
      selectedMoveToLibraryTarget({
        projectId: argumentsToSubmit.project,
        libraryId: argumentsToSubmit.library,
      })
    )

  const openProjectCommand: Command = {
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

        const projectSession = projectSessionSnapshot()
        if (!projectSession || typeof record.name !== 'string') {
          toast.error('Select a project that can be opened.')
          return
        }

        return projectSession.getDefaultProjectDirectoryPath().then((root) => {
          const projectPath = isAbsoluteProjectPath(record.name)
            ? record.name
            : fsZds.join(root, record.name)
          navigateToProjectFile(projectPath)
        })
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

  const duplicateProjectCommand: Command = {
    icon: 'folder',
    name: 'Duplicate project',
    displayName: 'Duplicate project',
    description: 'Duplicate a project',
    groupId: 'projects',
    needsReview: false,
    onSubmit: (record) => {
      if (!record) {
        return
      }

      const target = selectedHomeProjectTarget(record.project, 'duplicate')
      if (!target) {
        toast.error('Select a project that can be duplicated.')
        return
      }

      return target.actions.duplicate(target.project)
    },
    args: {
      project: {
        inputType: 'options',
        required: true,
        options: () => projectOptions('duplicate'),
      },
    },
  }

  const createProjectCommand: Command = {
    icon: 'folder',
    name: 'Create project',
    displayName: `Create project`,
    description: 'Create a project',
    groupId: 'projects',
    needsReview: false,
    onSubmit: (record) => {
      if (record) {
        const target = selectedCreateProjectTarget(record.libraryId)
        if (!target) {
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

  const moveToLibraryCommand: Command = {
    icon: 'folder',
    name: 'Move project',
    displayName: 'Move project',
    description: 'Move a project to another library',
    groupId: 'projects',
    needsReview: true,
    onSubmit: (record) => {
      if (!record) {
        return
      }

      const target = selectedMoveToLibraryTarget({
        projectId: record.project,
        libraryId: record.library,
      })
      if (!target) {
        toast.error('Select a library that can receive this project.')
        return
      }

      return target.actions
        .moveToLibrary(target.project, target.moveTarget.library.id)
        .then((result) => {
          if (isCurrentHomeProject(target.project) && result?.defaultFile) {
            navigateToProjectFile(result.defaultFile)
          }
        })
    },
    reviewMessage: ({ argumentsToSubmit }) => {
      const target = selectedMoveToLibraryTarget({
        projectId: argumentsToSubmit.project,
        libraryId: argumentsToSubmit.library,
      })
      const projectName = projectDisplayNameFromCommandValue(
        argumentsToSubmit.project,
        'moveToLibrary'
      )
      const sourceLibrary = target?.moveTarget.sourceLibrary
      const targetLibrary = target?.moveTarget.library
      const differentType =
        sourceLibrary &&
        targetLibrary &&
        sourceLibrary.type !== targetLibrary.type

      return CommandBarOverwriteWarning({
        heading: differentType
          ? 'Move project to a different library type?'
          : 'Move project?',
        message: target
          ? `This will move "${projectName}" from "${sourceLibrary?.title}" to "${targetLibrary?.title}".${
              differentType
                ? ' Library-specific behavior such as cloud syncing may change.'
                : ''
            }`
          : `This will move "${projectName}" to another library.`,
      })
    },
    args: {
      project: {
        inputType: 'options',
        required: true,
        hidden: hasSelectedMoveToLibraryTarget,
        options: () => projectOptions('moveToLibrary'),
      },
      library: {
        inputType: 'options',
        required: true,
        prepopulate: true,
        hidden: hasSelectedMoveToLibraryTarget,
        options: moveToLibraryOptions,
        defaultValue: defaultMoveToLibraryId,
      },
    },
  }

  const deleteProjectCommand: Command = {
    icon: 'folder',
    name: 'Delete project',
    displayName: `Delete project`,
    description: 'Delete a project',
    groupId: 'projects',
    needsReview: true,
    onSubmit: (record) => {
      if (record) {
        const target = selectedHomeProjectTarget(record.name, 'delete')
        if (!target) {
          toast.error('Select a project that can be deleted.')
          return
        }

        return target.actions.delete(target.project)
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
    icon: 'folder',
    name: 'Rename project',
    displayName: `Rename project`,
    description: 'Rename a project',
    groupId: 'projects',
    needsReview: true,
    onSubmit: (record) => {
      if (record) {
        const target = selectedHomeProjectTarget(record.oldName, 'rename')
        if (!target) {
          toast.error('Select a project that can be renamed.')
          return
        }

        return target.actions.rename(target.project, record.newName)
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

          return projectDirectoryName || defaultProjectFolderNameSnapshot()
        },
      },
    },
  }

  const importFileFromURL: Command = {
    name: 'Import file from URL',
    groupId: 'projects',
    icon: 'file',
    description: 'Create a file',
    needsReview: true,
    onSubmit: (record) => {
      if (record) {
        const projectSession = projectSessionSnapshot()
        if (!projectSession) {
          toast.error('Unable to import the file without a project session.')
          return
        }

        const target = selectedHomeProjectTarget(record.projectName, 'open')
        const requestedProjectName =
          record.method === 'existingProject'
            ? (target?.project.localProjectName ??
              target?.project.name ??
              record.projectName)
            : undefined

        return projectSession
          .createKclFiles({
            requestedProjectName,
            files: [
              {
                requestedProjectName,
                requestedFileName: record.name,
                requestedCode: record.code ?? '',
              },
            ],
          })
          .then((result) => {
            toast.success(result.message)
            if (result.filePath) {
              navigateToProjectFile(result.filePath)
            }
          })
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
        options: importProjectOptions,
        defaultValue: defaultImportProjectId,
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

  const projectCommands = enableProjectDirectoryCommands
    ? [
        openProjectCommand,
        createProjectCommand,
        duplicateProjectCommand,
        moveToLibraryCommand,
        deleteProjectCommand,
        renameProjectCommand,
        importFileFromURL,
      ]
    : [importFileFromURL]

  return projectCommands
}
