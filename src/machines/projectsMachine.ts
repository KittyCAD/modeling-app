import { assign, fromPromise, setup } from 'xstate'
import { ProjectsCommandSchema } from 'lib/commandBarConfigs/projectsCommandConfig'
import { Project } from 'lib/project'
import { isArray } from 'lib/utils'

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
      | {
          type: 'Rename project'
          data: ProjectsCommandSchema['Rename project']
        }
      | {
          type: 'Create project'
          data: ProjectsCommandSchema['Create project']
        }
      | {
          type: 'Delete project'
          data: ProjectsCommandSchema['Delete project']
        }
      | { type: 'navigate'; data: { name: string } }
      | {
          type: 'xstate.done.actor.read-projects'
          output: Project[]
        }
      | {
          type: 'xstate.done.actor.delete-project'
          output: { message: string; name: string }
        }
      | {
          type: 'xstate.done.actor.create-project'
          output: { message: string; name: string }
        }
      | {
          type: 'xstate.done.actor.rename-project'
          output: { message: string; oldName: string; newName: string }
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
        'output' in event && isArray(event.output)
          ? event.output
          : context.projects,
    }),
    toastSuccess: () => {},
    toastError: () => {},
    navigateToProject: () => {},
    navigateToProjectIfNeeded: () => {},
  },
  actors: {
    readProjects: fromPromise(() => Promise.resolve([] as Project[])),
    createProject: fromPromise(
      (_: { input: { name: string; projects: Project[] } }) =>
        Promise.resolve({ message: '' })
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
      }) =>
        Promise.resolve({
          message: '',
          oldName: '',
          newName: '',
        })
    ),
    deleteProject: fromPromise(
      (_: { input: { defaultDirectory: string; name: string } }) =>
        Promise.resolve({
          message: '',
          name: '',
        })
    ),
  },
  guards: {
    'Has at least 1 project': () => false,
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QAkD2BbMACdBDAxgBYCWAdmAMS6yzFSkDaADALqKgAOqtALsaqXYgAHogAsAJgA0IAJ6IAjBIkA2AHQAOCUw0qNkjQE4xYjQF8zMtJhwES5NcmpZSqLBwBOqAFZh8PWAoAJTBcCHcvX39YZjYkEC5efkF40QQFFQBmAHY1Qwz9QwBWU0NMrRl5BGyxBTUVJlVM01rtBXNLEGtsPCIyMEdnVwifPwCKAGEPUJ5sT1H-WKFE4j4BITSMzMzNIsyJDSZMhSYmFWzKxAkTNSYxIuU9zOKT7IsrDB67fsHYEajxiEwv8xjFWMtuKtkhsrpJboZsioincFMdTIjLggVGJ1GImMVMg0JISjEV3l1PrY+g4nH95gDAiFSLgbPSxkt4is1ilQGlrhJ4YjkbU0RoMXJEIYkWoikV8hJinjdOdyd0qfYBrSQdFJtNcLNtTwOZxIdyYQh+YKkSjReKqqYBQoEQpsgiSi9MqrKb0Nb9DYEACJgAA2YANbMW4M5puhqVhAvxQptCnRKkxCleuw0Gm2+2aRVRXpsPp+Woj4wA8hwwKRDcaEjH1nGLXDE9aRSmxWmJVipWocmdsbL8kxC501SWHFMZmQoIaKBABAMyAA3VAAawG+D1swAtOX61zY7zENlEWoMkoatcdPoipjCWIZRIirozsPiYYi19qQNp-rZ3nMAPC8Dw1A4YN9QAM1QDx0DUbcZjAfdInZKMTSSJsT2qc9Lwka8lTvTFTB2WUMiyQwc3yPRv3VH4mRZQDywXJc1FXDcBmmZlMBQhYjXQhtMJ5ERT1wlQr0kQj7kxKiZTxM5s2zbQEVoycBgY9AmNQ-wKGA0DwMgngYLgtQuJZZCDwEo8sJEnD1Dwgjb2kntig0GUkWVfZDEMfFVO+Bwg1DPhSDnZjFwcdjNzUCAQzDCztP4uIMKhGy0jPezxPwySnPvHsTjlPIhyOHRsnwlM-N-NRArDLS+N0kDYIM6DYPgmKgvivjD0bYS+VbBF21RTs7UUUcimfRpXyYRF8LFCrfSBCBaoZFiItINcor1CBeIZLqhPNdKL0yxzs2cqoNDqdpSo0EoSoLOb6NCRaQv9FblzWjjTMe7bQQYBQksElKesUMRjFubRMllCHsm2a5MVldRDBfFpmj0IpxPuhwFqW0F6v0iDmpMzbvuiXbAfNFNQcaI5IaKaH9jETFsUMNRVDxOU5TxBULE6VwYvgeIJ38sAIT25td27KpdzG7yZeho5slHVmMc1IY3HLfnkrNZt2hOW5smRCQM2uhQHkZ6VtkRBFnmu0qFGVv11ZFsnm0kdN8QFJVjlUPZ9co+3-2C0KEqdrXsJMJ8ryc86iUyYiCvxFNzldb3jHtjTsf8EPj1ssQchZlR8jR5EmDRrIGZcuF7maF1aZtslx29IWqtiwPDSz1LxDxepnlOfYDghp03eyOpngzXuYdHNPHozgJ26B9IXR2cTvP0BVkSRXKqgLtyq8OfQcXOwlubMIA */
  id: 'Home machine',

  initial: 'Reading projects',

  context: ({ input }) => ({
    ...input,
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
          target: 'Reading projects',
          actions: 'navigateToProject',
          reenter: true,
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
            actions: ['toastSuccess', 'navigateToProject'],
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
            actions: ['toastSuccess', 'navigateToProjectIfNeeded'],
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
            actions: ['toastSuccess', 'navigateToProjectIfNeeded'],
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
  },
})
