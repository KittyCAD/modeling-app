import { CommandSetConfig } from 'lib/commandTypes'
import { homeMachine } from 'machines/homeMachine'

export type HomeCommandSchema = {
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

export const homeCommandBarConfig: CommandSetConfig<
  typeof homeMachine,
  HomeCommandSchema
> = {
  'Open project': {
    icon: 'arrowRight',
    description: 'Open a project',
    args: {
      name: {
        inputType: 'options',
        required: true,
        options: (context) =>
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
        defaultValue: (context) => context.defaultProjectName,
      },
    },
  },
  'Delete project': {
    icon: 'close',
    description: 'Delete a project',
    needsReview: true,
    args: {
      name: {
        inputType: 'options',
        required: true,
        options: (context) =>
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
        options: (context) =>
          context.projects.map((p) => ({
            name: p.name!,
            value: p.name!,
          })),
      },
      newName: {
        inputType: 'string',
        required: true,
        defaultValue: (context) => context.defaultProjectName,
      },
    },
  },
}
