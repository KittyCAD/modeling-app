import { CommandSetConfig } from 'lib/commandTypes'
import { homeMachine } from 'machines/homeMachine'

type HomeCommandSchema = {
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
        inputType: 'string',
      },
    },
  },
  'Create project': {
    icon: 'folderPlus',
    description: 'Create a project',
    args: {
      name: {
        inputType: 'string',
        defaultValue: (context) => context.defaultProjectName,
      },
    },
  },
  'Delete project': {
    icon: 'close',
    description: 'Delete a project',
    args: {
      name: {
        inputType: 'string',
      },
    },
  },
  'Rename project': {
    icon: 'folder',
    description: 'Rename a project',
    args: {
      oldName: {
        inputType: 'string',
      },
      newName: {
        inputType: 'string',
      },
    },
  },
}
