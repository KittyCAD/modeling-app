import { CommandBarOverwriteWarning } from 'components/CommandBarOverwriteWarning'
import { StateMachineCommandSetConfig } from 'lib/commandTypes'
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
}
