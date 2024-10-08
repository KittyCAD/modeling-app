import { UnitLength_type } from '@kittycad/lib/dist/types/src/models'
import { CommandBarOverwriteWarning } from 'components/CommandBarOverwriteWarning'
import { StateMachineCommandSetConfig } from 'lib/commandTypes'
import { baseUnitLabels, baseUnitsUnion } from 'lib/settings/settingsTypes'
import { projectsMachine } from 'machines/projectsMachine'

export type ProjectsCommandSchema = {
  'Read projects': {}
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
    units: UnitLength_type
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
    args: {
      name: {
        inputType: 'options',
        required: true,
        options: [],
        optionsFromContext: (context) =>
          context.projects.map((p) => ({
            name: p.name!,
            value: p.name!,
          })),
      },
    },
  },
  'Create project': {
    icon: 'folderPlus',
    description: 'Create a project',
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
        options: [],
        optionsFromContext: (context) =>
          context.projects.map((p) => ({
            name: p.name!,
            value: p.name!,
          })),
      },
    },
  },
  'Rename project': {
    icon: 'folder',
    description: 'Rename a project',
    needsReview: true,
    args: {
      oldName: {
        inputType: 'options',
        required: true,
        options: [],
        optionsFromContext: (context) =>
          context.projects.map((p) => ({
            name: p.name!,
            value: p.name!,
          })),
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
    args: {
      method: {
        inputType: 'options',
        required: true,
        skip: true,
        options: [
          { name: 'New Project', value: 'newProject' },
          { name: 'Existing Project', value: 'existingProject' },
        ],
      },
      // TODO: We can't get the currently-opened project to auto-populate here because
      // it's not available on projectMachine, but lower in fileMachine. Unify these.
      projectName: {
        inputType: 'options',
        required: (commandsContext) => commandsContext.argumentsToSubmit.method === 'existingProject',
        skip: true,
        options: [],
        optionsFromContext: (context) =>
          context.projects.map((p) => ({
            name: p.name!,
            value: p.name!,
          })),
      },
      name: {
        inputType: 'string',
        required: true,
        skip: true,
      },
      code: {
        inputType: 'text',
        required: false,
        skip: true,
      },
      units: {
        inputType: 'options',
        required: false,
        skip: true,
        options: baseUnitsUnion.map((unit) => ({
          name: baseUnitLabels[unit],
          value: unit,
        })),
      },
    },
    reviewMessage(commandBarContext) {
      return `Will add the contents from URL to a new ${commandBarContext.argumentsToSubmit.method === 'newProject' ? 'project with file main.kcl' : `file within the project "${commandBarContext.argumentsToSubmit.projectName}"`} named "${commandBarContext.argumentsToSubmit.name}", and set default units to "${commandBarContext.argumentsToSubmit.units}".`
    },
  }
}
