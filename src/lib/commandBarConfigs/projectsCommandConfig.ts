import { CommandBarOverwriteWarning } from '@src/components/CommandBarOverwriteWarning'
import type { StateMachineCommandSetConfig } from '@src/lib/commandTypes'
import { isDesktop } from '@src/lib/isDesktop'
import type { projectsMachine } from '@src/machines/projectsMachine'

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
