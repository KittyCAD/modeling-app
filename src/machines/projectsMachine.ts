import { assign, fromPromise, setup } from 'xstate'
import { ProjectsCommandSchema } from 'lib/commandBarConfigs/projectsCommandConfig'
import { Project } from 'lib/project'

export const projectsMachine = setup({
  types: {
    context: {} as {
      projects: Project[]
      defaultProjectName: string
      defaultDirectory: string
    },
    events: {} as
      | { type: 'Read projects'; data: {} }
      | { type: 'Open project'; data: ProjectsCommandSchema['Open project'] }
      | { type: 'Rename project'; data: ProjectsCommandSchema['Rename project'] }
      | { type: 'Create project'; data: ProjectsCommandSchema['Create project'] }
      | { type: 'Delete project'; data: ProjectsCommandSchema['Delete project'] }
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
    createProject: fromPromise((_: { input: { name: string, projects: Project[] } }) =>
      Promise.resolve('')
    ),
    renameProject: fromPromise(
      (_: {
        input: {
          oldName: string
          newName: string
          defaultProjectName: string
          defaultDirectory: string
          projects: Project[]
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
  /** @xstate-layout N4IgpgJg5mDOIC5QAkD2BbMACdBDAxgBYCWAdmAMS6yzFSkDaADALqKgAOqtALsaqXYgAnogC0ADgDsAOgCM0gEwTFAVgBsitaonqANCAAeiNdJkSALIqYBOGzoDMcm+oC+rg2kw4CJcjORqLFJULA4AJ1QAKzB8HlgKACUwXAgwyJi42GY2JBAuXn5BPOMEB01zKQcLZwVVOQsmJlUDUQRpWSYtGokNG0UFB3dPDGw8IjIwAKCQ9OjY+IoAYXCUnmwI+bicoQLiPgEhUql1WQsJBpsVFXVVHVbEGwsHGSYHaylVJgt1OXUbIYeEBeMa+SbTWBzTKLZKpKELbKsXbcfZFI6IdROGRaLQOJgSCQuWz6ESPAHY5RSKnVN4A4bA0Y+Cb+QKQzbQhLJUi4bzshY7PJ7A7FUDHVSdaqqBwOK6KKr9B4IdTfGRfNRSOQnWxyLr0kFMvxTVnwrLLVa4dYmngCzgo4XohAnRTydSEwl3JwDCyKywSVUatQODRyHESPWM8aGiFWhIAETAABswJa+dskYK7WiSogTn6HE6LKofkWmCS2lIfjILFJdMoVP0Q1Jw95I+DjanFgB5DhgUhWm35TOHbNlKpVqm++rPapPH1yVSvX6KTGYhoVxTN0HMqYrNZkKBWigQARTMgAN1QAGspvhzesxB2B0Ks6KTIoLDZsZ65DLMUwpDYipSP+2LAZ8QbSK6ig2JuBrgruFr7oeYDhJE4QyBwCYWgAZqg4ToDIt5rGAD4ZPy6a2oUw6vgg1hFq8Vh2BI+IaGoQEgXK-5SjoubQbBrb+FyPJIR2R4njI55XlMqzcpgpFbNaFGDlRIpGIgDTVK8NghjYTA6uUigOIqzxyFWyjvIGAI1vm-FgoJvbCaQB6iShaEYVhPC4fhMgyTyJGPkpz7UWpCAhgMMhSHWdzvh+bxlogJlmRIFlSlZyVNkC+oCVM8ZJnwTmHse-iSdeMgQImyb+WRaa5JRqLBaUgwLv8GqEuo6jVv03qkrRH7Ypi9S9A0UrVrZ24yLlyYidVPAUK5eHuTheEEeVeVVQpT5DqpjXii83zVGoTz-ioLQ9e+n7LkGdTDdUkVjVGsIQNNCkJEVp6kBepXmhA8kcptKkOu+zqpecNhUh1H4Aoqt2Lk4fyanIiNuJlEZ2VMj3PRyYnFR9Uk+SkP0dtkci1cp9XbeIDRMC6yoqBWpY6GxPUw6WeKnH80GXPd4IYwVRNzahC2YUt3nfb9CL-eTDpiD+1P9BqGp3JozinW0AyftIzQ6FYro6huKMtmjMjdr2mMLBQkv2iOMsVlWNQaP8eKFqogE9VcC6RcoVi9J8WvuECITlfAeRZWjyIA9bOJ2-O7UAt8dyu20NsWDI+aFponxPF73MsjMoRE+HUsjmDryGcxVw6lTzSKi7fo-lU3y6F1yMjIb43tjNwd1VbNEOLoMh2JdCi6Tovyq4gtfyPmTtN++vw5zud5m3Ehc9yFYULjqqjQU3-y4oqummdYunMdY6p3AvMhCegy88KvL7r+drwNFYffaQC9iKsqC7aYW0qWMqBochL6TXys5Ga98GrqX+NTaCVRLAAn+JiRQX9EbmBlM4Cs04rgZVbluB6BNb5dzJmvUo0EXjtWlDUYCIY-zj3aC8ZiyVngWGrMxKUgI8FwX8CbUgt9IEUwQGIRoqdbh-ClASJodYD4lzlASRo2l0pPH9q4IAA */
  id: 'Home machine',

  initial: 'Reading projects',

  context: ({ input }) => ({
    ...input
  }),

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
        input: ({ event, context }) => {
          if (event.type !== 'Create project') {
            return {
              name: '',
              projects: context.projects,
            }
          }
          return {
            name: event.data.name,
            projects: context.projects,
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
              projects: context.projects,
            }
          }
          return {
            defaultProjectName: context.defaultProjectName,
            defaultDirectory: context.defaultDirectory,
            oldName: event.data.oldName,
            newName: event.data.newName,
            projects: context.projects,
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

      always: "Reading projects"
    },
  },
})
