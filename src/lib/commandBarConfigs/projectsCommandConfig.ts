import { CommandBarOverwriteWarning } from '@src/components/CommandBarOverwriteWarning'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import { getInitialProjectDirectoryPath } from '@src/lib/desktop'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import type { commandBarMachine } from '@src/machines/commandBarMachine'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import type { ActorRefFrom, ContextFrom } from 'xstate'
export type ProjectsCommandSchema = {
  'Create project': {
    name: string
    parentDirectory?: string
  }
  'Import file from URL': {
    name: string
    code?: string
    method: 'newProject' | 'existingProject'
    parentDirectory?: string
    projectName?: string
  }
}

function defaultEnableProjectDirectoryCommands() {
  return typeof window !== 'undefined' && Boolean(window.electron)
}

function isPathLike(pathOrName: unknown): pathOrName is string {
  return typeof pathOrName === 'string' && /[/\\]/.test(pathOrName)
}

function basenameFromPath(pathOrName: string) {
  const normalizedPath = pathOrName.replaceAll('\\', '/').replace(/\/+$/g, '')
  const lastSeparatorIndex = normalizedPath.lastIndexOf('/')
  return lastSeparatorIndex === -1
    ? normalizedPath || pathOrName
    : normalizedPath.slice(lastSeparatorIndex + 1) || pathOrName
}

export function createProjectCommands({
  systemIOActor,
  enableProjectDirectoryCommands = defaultEnableProjectDirectoryCommands(),
}: {
  systemIOActor: ActorRefFrom<typeof systemIOMachine>
  enableProjectDirectoryCommands?: boolean
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
  const findFolderByPathOrName = (pathOrName: unknown) => {
    if (typeof pathOrName !== 'string') {
      return undefined
    }

    return folderSnapshot()?.find(
      (folder) => folder.path === pathOrName || folder.name === pathOrName
    )
  }
  const projectOptionName = (
    folder: NonNullable<ReturnType<typeof folderSnapshot>>[number],
    folders: NonNullable<ReturnType<typeof folderSnapshot>>
  ) => {
    const displayName = getProjectDisplayName(folder)
    const baseName =
      displayName === folder.name
        ? displayName
        : `${displayName} (${folder.name})`
    const hasDuplicateName = folders.some(
      (otherFolder) =>
        otherFolder.path !== folder.path &&
        getProjectDisplayName(otherFolder) === displayName
    )

    return hasDuplicateName ? `${baseName} - ${folder.path}` : baseName
  }

  const defaultProjectFolderNameSnapshot = () => {
    const { defaultProjectFolderName } = systemIOActor.getSnapshot().context
    return defaultProjectFolderName
  }
  const defaultProjectDirectoryPath = async (
    _commandBarContext: ContextFrom<typeof commandBarMachine>,
    _machineContext?: ContextFrom<typeof systemIOMachine>,
    wasmInstance?: Parameters<typeof getInitialProjectDirectoryPath>[0]
  ) => {
    if (!isDesktop()) {
      return ''
    }

    return getInitialProjectDirectoryPath(wasmInstance)
  }

  const openProjectCommand: Command = {
    icon: 'folder',
    name: 'Open project',
    displayName: `Open project`,
    description: 'Open a project',
    groupId: 'projects',
    needsReview: false,
    onSubmit: (record) => {
      if (record?.path) {
        const projectPath = String(record.path)
        systemIOActor.send({
          type: SystemIOMachineEvents.navigateToProject,
          data: {
            requestedProjectName: basenameFromPath(projectPath),
            requestedProjectPath: projectPath,
          },
        })
      }
    },
    args: {
      path: {
        required: true,
        inputType: 'path',
        filters: [],
        openDialogProperties: ['openDirectory'],
        openDialogTitle: 'Open a project folder',
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
      if (record?.name) {
        systemIOActor.send({
          type: SystemIOMachineEvents.createProject,
          data: {
            requestedProjectName: String(record.name),
            requestedProjectDirectoryPath: record.parentDirectory
              ? String(record.parentDirectory)
              : undefined,
          },
        })
      }
    },
    args: {
      parentDirectory: {
        required: () => isDesktop(),
        hidden: () => !isDesktop(),
        skip: true,
        inputType: 'path',
        filters: [],
        openDialogProperties: ['openDirectory'],
        openDialogTitle: 'Choose where to create the project',
        defaultValue: defaultProjectDirectoryPath,
        displayName: 'Parent folder',
      },
      name: {
        required: true,
        inputType: 'string',
        defaultValue: defaultProjectFolderNameSnapshot,
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
        const project = findFolderByPathOrName(record.name)
        const projectPath =
          project?.path || (isPathLike(record.name) ? record.name : undefined)
        systemIOActor.send({
          type: SystemIOMachineEvents.deleteProject,
          data: {
            requestedProjectName:
              project?.name ||
              (projectPath
                ? basenameFromPath(projectPath)
                : String(record.name || '')),
            projectPath,
          },
        })
      }
    },
    reviewMessage: ({ argumentsToSubmit }) => {
      const project = findFolderByPathOrName(argumentsToSubmit.name)
      return CommandBarOverwriteWarning({
        heading: 'Are you sure you want to delete?',
        message: `This will permanently delete the project "${
          project ? getProjectDisplayName(project) : argumentsToSubmit.name
        }" and all its contents.`,
      })
    },
    args: {
      name: {
        inputType: 'options',
        required: true,
        options: () => {
          const folders = folderSnapshot()
          const options: CommandArgumentOption<string>[] = []
          if (!folders) return options

          folders.forEach((folder) => {
            options.push({
              name: projectOptionName(folder, folders),
              value: folder.path,
              isCurrent: false,
            })
          })
          return options
        },
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
        const project = findFolderByPathOrName(record.oldName)
        const projectPath =
          project?.path ||
          (isPathLike(record.oldName) ? String(record.oldName) : undefined)
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
            projectName:
              project?.name ||
              (projectPath
                ? basenameFromPath(projectPath)
                : String(record.oldName || '')),
            projectPath,
            redirect: !isOnHomePage, // only redirect when renaming from within a project
          },
        })
      }
    },
    args: {
      oldName: {
        inputType: 'options',
        required: true,
        options: () => {
          const folders = folderSnapshot()
          const options: CommandArgumentOption<string>[] = []
          if (!folders) return options

          folders.forEach((folder) => {
            options.push({
              name: projectOptionName(folder, folders),
              value: folder.path,
              isCurrent: false,
            })
          })
          return options
        },
      },
      newName: {
        inputType: 'string',
        required: true,
        defaultValue: (context: ContextFrom<typeof commandBarMachine>) => {
          // Prefill with the old project name if it's already selected
          const folder = findFolderByPathOrName(
            context.argumentsToSubmit.oldName
          )
          return folder
            ? getProjectDisplayName(folder)
            : String(
                context.argumentsToSubmit.oldName ||
                  defaultProjectFolderNameSnapshot()
              )
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
            requestedProjectDirectoryPath:
              record.method === 'newProject' && record.parentDirectory
                ? String(record.parentDirectory)
                : undefined,
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
      parentDirectory: {
        inputType: 'path',
        required: (commandsContext) =>
          isDesktop() &&
          commandsContext.argumentsToSubmit.method === 'newProject',
        hidden: (commandsContext) =>
          !isDesktop() ||
          commandsContext.argumentsToSubmit.method !== 'newProject',
        skip: true,
        filters: [],
        openDialogProperties: ['openDirectory'],
        openDialogTitle: 'Choose where to create the project',
        defaultValue: defaultProjectDirectoryPath,
        displayName: 'Parent folder',
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
          const folders = folderSnapshot()
          const options: CommandArgumentOption<string>[] = []
          if (!folders) return options

          folders.forEach((folder) => {
            options.push({
              name: folder.name,
              value: folder.name,
              isCurrent: false,
            })
          })
          return options
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
