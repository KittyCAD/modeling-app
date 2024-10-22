import { assign, fromPromise, setup } from 'xstate'
import { HomeCommandSchema } from 'lib/commandBarConfigs/homeCommandConfig'
import { Project } from 'lib/project'

export const homeMachine = setup({
  types: {
    context: {} as {
      projects: Project[]
      defaultProjectName: string
      defaultDirectory: string
    },
    events: {} as
      | { type: 'Read projects'; data: {} }
      | { type: 'Open project'; data: HomeCommandSchema['Open project'] }
      | { type: 'Rename project'; data: HomeCommandSchema['Rename project'] }
      | { type: 'Create project'; data: HomeCommandSchema['Create project'] }
      | { type: 'Delete project'; data: HomeCommandSchema['Delete project'] }
      | { type: 'navigate'; data: { name: string } }
      | {
          type: 'xstate.done.actor.read-projects'
          output: Project[]
        }
      | { type: 'assign'; data: { [key: string]: any } },
    input: {} as {
      projects: Project[]
      defaultProjectName: string
      defaultDirectory: string
    },
  },
  actions: {
    setProjects: assign({
      projects: ({ context, event }) =>
        'output' in event ? event.output : context.projects,
    }),
    toastSuccess: () => {},
    toastError: () => {},
    navigateToProject: () => {},
  },
  actors: {
    readProjects: fromPromise(() => Promise.resolve([] as Project[])),
    createProject: fromPromise((_: { input: { name: string } }) =>
      Promise.resolve('')
    ),
    renameProject: fromPromise(
      (_: {
        input: {
          oldName: string
          newName: string
          defaultProjectName: string
          defaultDirectory: string
        }
      }) => Promise.resolve('')
    ),
    deleteProject: fromPromise(
      (_: { input: { defaultDirectory: string; name: string } }) =>
        Promise.resolve('')
    ),
  },
  guards: {
    'Has at least 1 project': () => false,
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QAkD2BbMACdBDAxgBYCWAdmAHTK6xampYAOATqgFZj4AusAxAMLMwuLthbtOXANoAGALqJQjVLGJdiqUopAAPRAHYAbPooAWABwBGUwE5zAJgeGArM-MAaEAE9EN0wGYKGX97GX1nGVNDS0MbfwBfeM80TBwCEnIqGiZWDm4+ACUwUlxU8TzpeW1lVXVNbT0EcJNg02d-fzt7fU77Tx8EQ0iKCPtnfUsjGRtLGXtE5IxsPCIySmpacsk+QWFRHIluWQUkEBq1DS1TxqN7ChjzOxtXf0t7a37EcwsRibH-ZzRezA8wLEApZbpNZZTa5ba8AAiYAANmB9lsjlVTuc6ldQDdDOYKP5bm0os5TDJDJ8mlEzPpzIZHA4bO9umCIWlVpkNgcKnwAPKMYp8yTHaoqC71a6IEmBUz6BkWZzWDq2Uw0qzOIJAwz+PXWfSmeZJcFLLkZSi7ERkKCi7i8CCaShkABuqAA1pR8EIRGAALQYyonJSS3ENRDA2wUeyvd6dPVhGw0-RhGOp8IA8xGFkc80rS0Ua3qUh2oO8MDMVjMCiMZEiABmqGY6AoPr2AaD4uxYcuEYQoQpQWNNjsMnMgLGKbT3TC7TcOfsNjzqQL0KKJXQtvtXEdzoobs9lCEm87cMxIbOvel+MQqtMQRmS5ks31sZpAUsZkcIX+cQZJIrpC3KUBupTbuWlbVrW9ZcE2LYUCepRnocwYSrUfYyggbzvBQ+jMq49imLYwTUt4iCft+5i-u0-7UfoQEWtCSKoiWZbnruTqZIeXoUBAKJoihFTdqGGE3rod7UdqsQTI8hiGAqrIauRA7RvYeoqhO1jtAqjFrpkLFohBHEVlWzYwY2zatvxrFCWKWKiVKeISdh4yBJE-jGs4fhhA4zg0kRNgxhplhaW0nn4XpUKZEUuAQMZqF8FxLqkO6vG+hAgYcbAIlXmJzmNERdy0RYNiKgpthxDSEU6q8MSTJYjWGFFIEULF8WljuSX7jxx7CJlQY5ZYl44pht4IP61gyPc8njt0lIuH51UKrVVITEyMy2C1hbtQl-KmdBdaWQhGVZYluWjeJjSTf402shMEyuEyljPAFL0UNmMiuN86lWHMiSmvQ-HwKcnL6WA6FOf2k3mESMRDA4RpUm4U4qf6gSEt0QIvvqfjOCaiyrtF6zZPQXWQ+GWFlUEsbmNMf1TV9NLeXDcqRIySnNaaYPEzC5M9vl-b+IyFCjupryPF9jKWP5Kks-cbMWLERHRNt0LFntkgU2NLk4dqsz43YsTK++Kk2C+MbTOOcxzOMrhqzFxTgZ1Qba1dd6BUE1jGsLMxxK9KlDNqm3tMLUQvqYlgO5QhlsTubsFXesTTUuPTfHExshDS0RftRftGgEnTZtHbX9Zr+QJ-2S4Y3qnmTC+4tMyp1EfeOnmeQqdOhyXQrFOXXCV1hCkmLDOnBJYvRRDSsyRzGjiKj0lKdAkANAA */
  id: 'Home machine',

  initial: 'Reading projects',

  context: {
    projects: [],
    defaultProjectName: '',
    defaultDirectory: '',
  },

  on: {
    assign: {
      actions: assign(({ event }) => ({
        ...event.data,
      })),
      target: '.Reading projects',
    },
  },
  states: {
    'Has no projects': {
      on: {
        'Read projects': {
          target: 'Reading projects',
        },
        'Create project': {
          target: 'Creating project',
        },
      },
    },

    'Has projects': {
      on: {
        'Read projects': {
          target: 'Reading projects',
        },

        'Rename project': {
          target: 'Renaming project',
        },

        'Create project': {
          target: 'Creating project',
        },

        'Delete project': {
          target: 'Deleting project',
        },

        'Open project': {
          target: 'Opening project',
        },
      },
    },

    'Creating project': {
      invoke: {
        id: 'create-project',
        src: 'createProject',
        input: ({ event }) => {
          if (event.type !== 'Create project') {
            return {
              name: '',
            }
          }
          return {
            name: event.data.name,
          }
        },
        onDone: [
          {
            target: 'Reading projects',
            actions: ['toastSuccess'],
          },
        ],
        onError: [
          {
            target: 'Reading projects',
            actions: ['toastError'],
          },
        ],
      },
    },

    'Renaming project': {
      invoke: {
        id: 'rename-project',
        src: 'renameProject',
        input: ({ event, context }) => {
          if (event.type !== 'Rename project') {
            // This is to make TS happy
            return {
              defaultProjectName: context.defaultProjectName,
              defaultDirectory: context.defaultDirectory,
              oldName: '',
              newName: '',
            }
          }
          return {
            defaultProjectName: context.defaultProjectName,
            defaultDirectory: context.defaultDirectory,
            oldName: event.data.oldName,
            newName: event.data.newName,
          }
        },
        onDone: [
          {
            target: '#Home machine.Reading projects',
            actions: ['toastSuccess'],
          },
        ],
        onError: [
          {
            target: '#Home machine.Reading projects',
            actions: ['toastError'],
          },
        ],
      },
    },

    'Deleting project': {
      invoke: {
        id: 'delete-project',
        src: 'deleteProject',
        input: ({ event, context }) => {
          if (event.type !== 'Delete project') {
            // This is to make TS happy
            return {
              defaultDirectory: context.defaultDirectory,
              name: '',
            }
          }
          return {
            defaultDirectory: context.defaultDirectory,
            name: event.data.name,
          }
        },
        onDone: [
          {
            actions: ['toastSuccess'],
            target: '#Home machine.Reading projects',
          },
        ],
        onError: {
          actions: ['toastError'],
          target: '#Home machine.Has projects',
        },
      },
    },

    'Reading projects': {
      invoke: {
        id: 'read-projects',
        src: 'readProjects',
        onDone: [
          {
            guard: 'Has at least 1 project',
            target: 'Has projects',
            actions: ['setProjects'],
          },
          {
            target: 'Has no projects',
            actions: ['setProjects'],
          },
        ],
        onError: [
          {
            target: 'Has no projects',
            actions: ['toastError'],
          },
        ],
      },
    },

    'Opening project': {
      entry: ['navigateToProject'],
    },
  },
})
