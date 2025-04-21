import { CommandBarOverwriteWarning } from '@src/components/CommandBarOverwriteWarning'
import type { StateMachineCommandSetConfig } from '@src/lib/commandTypes'
import { isDesktop } from '@src/lib/isDesktop'
import type { projectsMachine } from '@src/machines/projectsMachine'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'

export type ProjectsCommandSchema = {
  'Read projects': Record<string, unknown>
  'Create project': {
    name: string
  }
  'Open project': {
    name: string
  }
  'Delete project': {
    name: string
  }
  'Rename project': {
    oldName: string
    newName: string
  }
  'Import file from URL': {
    name: string
    code?: string
    method: 'newProject' | 'existingProject'
    projectName?: string
  }
}

export const projectsCommandBarConfig: StateMachineCommandSetConfig<
  typeof projectsMachine,
  ProjectsCommandSchema
> = {
  'Open project': {
    icon: 'arrowRight',
    description: 'Open a project',
    status: isDesktop() ? 'active' : 'inactive',
    args: {
      name: {
        inputType: 'options',
        required: true,
        options: (_, context) =>
          context?.projects.map((p) => ({
            name: p.name,
            value: p.name,
          })) || [],
      },
    },
  },
  'Create project': {
    icon: 'folderPlus',
    description: 'Create a project',
    status: isDesktop() ? 'active' : 'inactive',
    args: {
      name: {
        inputType: 'string',
        required: true,
        defaultValueFromContext: (context) => context.defaultProjectName,
      },
    },
  },
  'Delete project': {
    icon: 'close',
    description: 'Delete a project',
    status: isDesktop() ? 'active' : 'inactive',
    needsReview: true,
    reviewMessage: ({ argumentsToSubmit }) =>
      CommandBarOverwriteWarning({
        heading: 'Are you sure you want to delete?',
        message: `This will permanently delete the project "${argumentsToSubmit.name}" and all its contents.`,
      }),
    args: {
      name: {
        inputType: 'options',
        required: true,
        options: (_, context) =>
          context?.projects.map((p) => ({
            name: p.name,
            value: p.name,
          })) || [],
      },
    },
  },
  'Rename project': {
    icon: 'folder',
    description: 'Rename a project',
    needsReview: true,
    status: isDesktop() ? 'active' : 'inactive',
    args: {
      oldName: {
        inputType: 'options',
        required: true,
        options: (_, context) =>
          context?.projects.map((p) => ({
            name: p.name,
            value: p.name,
          })) || [],
      },
      newName: {
        inputType: 'string',
        required: true,
        defaultValueFromContext: (context) => context.defaultProjectName,
      },
    },
  },
  'Import file from URL': {
    icon: 'file',
    description: 'Create a file',
    needsReview: true,
    status: 'active',
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
        options: (_, context) =>
          context?.projects.map((p) => ({
            name: p.name,
            value: p.name,
          })) || [],
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
  },
}

import {
  folderSnapshot,
  defaultProjectFolderNameSnapshot,
} from '@src/machines/systemIO/snapshotContext'
import { systemIOActor } from '@src/machines/appMachine'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'

export const openProjectCommand: Command = {
  icon: 'arrowRight',
  name: 'Open projecct',
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
        const options: CommandArgumentOption<any>[] = []
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

export const createProjectCommand: Command = {
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

export const deleteProjectCommand: Command = {
  icon: 'folder',
  name: 'Delete project',
  displayName: `Delete project`,
  description: 'Delete a project',
  groupId: 'projects',
  needsReview: false,
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
        const options: CommandArgumentOption<any>[] = []
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

export const renameProjectCommand: Command = {
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
        const options: CommandArgumentOption<any>[] = []
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

export const importFileFromURL: Command = {
  name: 'Import file from URL',
  groupId: 'projects',
  icon: 'file',
  description: 'Create a file',
  needsReview: true,
  onSubmit: (record) => {
    console.log('RECORD!', record)
    if (record) {
      systemIOActor.send({
        type: SystemIOMachineEvents.createKCLFile,
        data: {
          requestedProjectName: record.projectName,
          requestedCode: record.code,
          requestedFileName: record.name,
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
      options: (_, context) => {
        const folders = folderSnapshot()
        const options: CommandArgumentOption<any>[] = []
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

export const projectCommands = [
  openProjectCommand,
  createProjectCommand,
  deleteProjectCommand,
  renameProjectCommand,
  importFileFromURL,
]
