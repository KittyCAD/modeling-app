import { CommandBarOverwriteWarning } from '@src/components/CommandBarOverwriteWarning'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import { MAX_PROJECT_NAME_LENGTH } from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import { webSafePathSplit } from '@src/lib/pathUtils'
import {
  getProjectDirectoryOptions,
  getProjectDisplayName,
  getProjectOptionNameFromDirectoryName,
} from '@src/lib/projectDisplayName'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import { getProjectDirectoryNameFromTitle } from '@src/lib/projectName'
import { getHomeProjectDisplayName } from '@src/lib/homeProjects'
import type { commandBarMachine } from '@src/machines/commandBarMachine'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'
import type {
  ProjectLibraryCreateProjectInput,
  ProjectLibraryOperation,
} from '@src/registry/contracts/projectLibraries'
import toast from 'react-hot-toast'
import type { ActorRefFrom, ContextFrom } from 'xstate'
export type ProjectsCommandSchema = {
  'Create project': {
    name: string
    libraryId?: string
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
  createProject: ProjectLibraryOperation<ProjectLibraryCreateProjectInput>
}

type HomeProjectCommandAction = 'open' | 'rename' | 'delete'

interface HomeProjectCommandTarget {
  actions: HomeProjectActionsService
  project: HomeProjectEntry
}

function defaultEnableProjectDirectoryCommands() {
  return typeof window !== 'undefined' && Boolean(window.electron)
}

function currentLibraryIdFromLocation() {
  if (typeof window === 'undefined') {
    return undefined
  }

  const pathname = window.location.hash
    ? window.location.hash.replace(/^#/, '').split('?')[0]
    : window.location.pathname
  const libraryPathPrefix = `${PATHS.LIBRARY}/`
  if (!pathname.startsWith(libraryPathPrefix)) {
    return undefined
  }

  return decodeURIComponent(
    webSafePathSplit(pathname.slice(libraryPathPrefix.length))[0] ?? ''
  )
}

export function createProjectCommands({
  systemIOActor,
  enableProjectDirectoryCommands = defaultEnableProjectDirectoryCommands(),
  getCurrentProjectDirectoryName,
  getCreateProjectLibraryTargets,
  getHomeProjectActions,
  getHomeProjectEntries,
}: {
  systemIOActor: ActorRefFrom<typeof systemIOMachine>
  enableProjectDirectoryCommands?: boolean
  getCurrentProjectDirectoryName?: () => string | undefined
  getCreateProjectLibraryTargets?: () => readonly CreateProjectLibraryTarget[]
  getHomeProjectActions?: () => HomeProjectActionsService | undefined
  getHomeProjectEntries?: () => readonly HomeProjectEntry[] | undefined
}) {
  /**
   * Helper functions instead of importing these due to circular deps.
   * unable to resolve this in a cleaner way at the moment.
   * This is safe in terms of logic but visually ugly.
   * TODO: https://github.com/KittyCAD/modeling-app/issues/6032
   */
  const folderSnapshot = () => {
    const { folders } = systemIOActor.getSnapshot().context
    return folders
  }

  const defaultProjectFolderNameSnapshot = () => {
    const { defaultProjectFolderName } = systemIOActor.getSnapshot().context
    return defaultProjectFolderName
  }

  const currentProjectDirectoryNameSnapshot = () =>
    getCurrentProjectDirectoryName?.()
  const createProjectTargetsSnapshot = () => getCreateProjectLibraryTargets?.()
  const homeProjectActionsSnapshot = () => getHomeProjectActions?.()
  const homeProjectEntriesSnapshot = () => getHomeProjectEntries?.()

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
  ): CommandArgumentOption<string>[] | undefined =>
    homeProjectCommandTargets(action)?.map(({ project }) => ({
      name: getHomeProjectDisplayName(project),
      value: project.id,
      isCurrent: isCurrentHomeProject(project),
    }))

  const projectOptions = (action: HomeProjectCommandAction) => {
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
    const routeLibraryId = currentLibraryIdFromLocation()
    return (
      options.find((option) => option.value === routeLibraryId)?.value ??
      options[0]?.value ??
      ''
    )
  }

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

        systemIOActor.send({
          type: SystemIOMachineEvents.navigateToProject,
          data: { requestedProjectName: record.name },
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
          return target.createProject.run({
            library: target.library,
            requestedProjectName,
            requestedProjectTitle,
          })
        }

        systemIOActor.send({
          type: SystemIOMachineEvents.createProject,
          data: {
            requestedProjectName,
            requestedProjectTitle,
          },
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
        if (target) {
          return target.actions.delete(target.project)
        }

        systemIOActor.send({
          type: SystemIOMachineEvents.deleteProject,
          data: { requestedProjectName: record.name },
        })
      }
    },
    reviewMessage: ({ argumentsToSubmit }) =>
      CommandBarOverwriteWarning({
        heading: 'Are you sure you want to delete?',
        message: `This will permanently delete the project "${projectDisplayNameFromCommandValue(
          argumentsToSubmit.name,
          'delete'
        )}" and all its contents.`,
      }),
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
        if (target) {
          return target.actions.rename(target.project, record.newName)
        }

        // Only redirect back to the project when not on the home page
        const hash = window.location.hash
        const pathname = hash
          ? hash.replace(/^#/, '')
          : window.location.pathname
        const isOnHomePage = pathname.startsWith(PATHS.HOME)
        systemIOActor.send({
          type: SystemIOMachineEvents.renameProject,
          data: {
            requestedProjectName: record.newName,
            projectName: record.oldName,
            redirect: !isOnHomePage, // only redirect when renaming from within a project
          },
        })
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
    name: 'Import file from URL',
    groupId: 'projects',
    icon: 'file',
    description: 'Create a file',
    needsReview: true,
    onSubmit: (record) => {
      if (record) {
        systemIOActor.send({
          type: SystemIOMachineEvents.importFileFromURL,
          data: {
            requestedProjectName: record.projectName,
            requestedCode: record.code,
            requestedFileNameWithExtension: record.name,
          },
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

  const projectCommands = enableProjectDirectoryCommands
    ? [
        openProjectCommand,
        createProjectCommand,
        deleteProjectCommand,
        renameProjectCommand,
        importFileFromURL,
      ]
    : [importFileFromURL]

  return projectCommands
}
