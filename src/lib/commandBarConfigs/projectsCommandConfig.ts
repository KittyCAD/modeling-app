import { CommandBarOverwriteWarning } from '@src/components/CommandBarOverwriteWarning'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import { isDesktop } from '@src/lib/isDesktop'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import type { ActorRefFrom } from 'xstate'
export type ProjectsCommandSchema = {
  'Import file from URL': {
    name: string
    code?: string
    method: 'newProject' | 'existingProject'
    projectName?: string
  }
}

export function createProjectCommands({
  systemIOActor,
}: {
  systemIOActor: ActorRefFrom<typeof systemIOMachine>
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

  const openProjectCommand: Command = {
    icon: 'arrowRight',
    name: 'Open project',
    displayName: `Open project`,
    description: 'Open a project',
    groupId: 'projects',
    needsReview: false,
    onSubmit: (record) => {
      if (record) {
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
        options: () => {
          const folders = folderSnapshot()
          const options: CommandArgumentOption<string>[] = []
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
        systemIOActor.send({
          type: SystemIOMachineEvents.createProject,
          data: { requestedProjectName: record.name },
        })
      }
    },
    args: {
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
        systemIOActor.send({
          type: SystemIOMachineEvents.deleteProject,
          data: { requestedProjectName: record.name },
        })
      }
    },
    reviewMessage: ({ argumentsToSubmit }) =>
      CommandBarOverwriteWarning({
        heading: 'Are you sure you want to delete?',
        message: `This will permanently delete the project "${argumentsToSubmit.name}" and all its contents.`,
      }),
    args: {
      name: {
        inputType: 'options',
        required: true,
        options: () => {
          const folders = folderSnapshot()
          const options: CommandArgumentOption<string>[] = []
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
        systemIOActor.send({
          type: SystemIOMachineEvents.renameProject,
          data: {
            requestedProjectName: record.newName,
            projectName: record.oldName,
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
      newName: {
        inputType: 'string',
        required: true,
        defaultValue: defaultProjectFolderNameSnapshot,
      },
    },
  }

  const importFileFromURL: Command = {
    name: 'Import file from URL',
    groupId: 'projects',
    icon: 'file',
    description: 'Create a file',
    needsReview: true,
    hideFromSearch: true,
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
          const folders = folderSnapshot()
          const options: CommandArgumentOption<string>[] = []
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

  /** No disk-writing commands are available in the browser */
  const projectCommands = isDesktop()
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
