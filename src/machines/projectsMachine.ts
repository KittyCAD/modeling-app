import { assign, fromPromise, setup } from 'xstate'

import type { ProjectsCommandSchema } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import type { Project } from '@src/lib/project'
import { isArray } from '@src/lib/utils'

export const projectsMachine = setup({
  types: {
    context: {} as {
      projects: Project[]
      defaultProjectName: string
      defaultDirectory: string
      hasListedProjects: boolean
    },
    events: {} as
      | { type: 'Read projects'; data: ProjectsCommandSchema['Read projects'] }
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
      | {
          type: 'Import file from URL'
          data: ProjectsCommandSchema['Import file from URL']
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
      | {
          type: 'xstate.done.actor.create-file'
          output: { message: string; projectName: string; fileName: string }
        }
      | { type: 'assign'; data: { [key: string]: any } },
    input: {} as {
      projects: Project[]
      defaultProjectName: string
      defaultDirectory: string
      hasListedProjects: boolean
    },
  },
  actions: {
    setProjects: assign({
      projects: ({ context, event }) =>
        'output' in event && isArray(event.output)
          ? event.output
          : context.projects,
    }),
    setHasListedProjects: assign({
      hasListedProjects: () => true,
    }),
    toastSuccess: () => {},
    toastError: () => {},
    navigateToProject: () => {},
    navigateToProjectIfNeeded: () => {},
    navigateToFile: () => {},
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
    createFile: fromPromise(
      (_: {
        input: ProjectsCommandSchema['Import file from URL'] & {
          projects: Project[]
        }
      }) => Promise.resolve({ message: '', projectName: '', fileName: '' })
    ),
  },
  guards: {
    'Has at least 1 project': ({ event }) => {
      if (event.type !== 'xstate.done.actor.read-projects') return false
      return event.output.length ? event.output.length >= 1 : false
    },
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QAkD2BbMACdBDAxgBYCWAdmAMS6yzFSkDaADALqKgAOqtALsaqXYgAHogAsAJgA0IAJ6IAjAHYAbADoArBJVMFTCQA4mTAMwmxAXwsy0mHARLkKASXRcATjywAzYgBtsb3cMLABVACUAGWY2JBAuXn5BONEESRl5BAUFFQM1HQUxJSYATmyFAyUTKxsMbDwiMjA1ZGosUlQsDmCAKzB8HlgKcLBcCC7e-sGYoQTiPgEhVIUy9SKSiQ0NEwkclRyMxGKJNRKlMRVDU23zpRqQW3qHJpa2jonUPoGhgGF3UZ42G6nymMzicwWyVAyzKJzECg0OiYGjERhK+kOWUMSlOGiUlTEJlMxRKBnuj3sjXIr1gHy+g2Go3GwPpsDBnG48ySS0QGj0+Q0JTOGkqBg2JhKmNRJy2OyUEn0Kml5LqlMczVatJZUyGI1IuDs2oG7PinMhPIQfKYAqFShF+PFkrkRwkYjU8OUShKKhMKg0pUs1geqoa6ppdJ1FD+AKBk2NrFmZu5KV5-L9tvtYokEsxelRagUCoMiMumyUdpVdlDL01Ee+FAAImAAoC6zwTRDk9DU9b08LRY7MWd1AZcoS-aoLiYFJWnlSNW0jQyAPIcMCkNsdpOLFOWtOC-sO7NOzLbGWFbY6acmFESWdql7R3B8UhQNsUCACZpkABuqAA1s0+D-M+YAALRLluiQ7t2WRMGIbryjeBgGBIEglNsCi5sY6hMOchQqEoCLFCh97VtST4vm+S4UGA7jBO4agcH4z7eKg7joGowExhBcbtgm4LblCIiKPBiHZiKqHoZhuaFhoBbGMYBhiPBCgStUQYUuRzR6gaZDUXxH5fmov4Ac0-z6pgvEgvGsQctBwnLGJahIZJaEYdOmKEfJuQSoRRKSRcZHPNSunoPp750QxTEsTwbEcWoFkGuBkECfZXIwSJcEIS5Ekoe5MnOggXqIaUqFiiUhIInemkhiFzRNi2EU0Z+1KmYBagQM2YCAtZ9JQRljmiTlrn5dJnlFShOLwcpZjKBs+KBrUVb1WojU9c1hlRexMWsexnFdS2KV8QN5q7laNqHlmOaTcpmjoWc8L6HoYrBfOagjGMm02QyrXfqQf4dSBEB9Tqp1dllebichUkeVhRXTiU+QecUKhCps4pvWGn0QN9rJGW1ANmYlTKg98DAKHZpoORanoyqh8oImU3pKJifJ5Ohdr7CYqjIvKWMvDjeORttjHMXtCXA2T0xpdTg20+W9MSIzgorIRXlpr6ORbPs+jwQLFEgVRPj+JQf0mUTHXcaBYG+AE4OZcsxbuts5hbCK+zFmImJgSc5zPV6BQVD6RQG80lERXblCi7tcX7VxRvgVHDtDQgaE4vK2gXKiTA6ItubmJo8IoqOylERUVhBh0XXwHEWn1YmNO7mBKg+2KpzK2IpIBUwBhqUtwYre9tbvEutfpWdsFFnkPpVJnQqz15Ozur36FoypREbGH4Zj438u7tO1qIu5qK5PBGyYjebpEkS44e9oVTbxHr5tnvk9ZeXajTuW+zaHNuzYRUmoeCEp-RKlUHJbeYVhYDDfhDVIxR5IGGnISQk6E+6EkxMUBQX9c66EMMg3Q5Zt7rWNkuOBjsjilDUAqQsZQzzgOkJNUk7o7SmF-tiXOUCmQwMGBQ1OF4TgVGzFUG8yIxQGDZiYPI4oqh+mPsrDSy05xhmfm+KO-CLT+iRucEUuwFQqWzMWXM2YTAuTtL6ZBylkRcMrkAA */
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
    },

    'Import file from URL': '.Creating file',
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
          if (
            event.type !== 'Create project' &&
            event.type !== 'Import file from URL'
          ) {
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
            actions: ['setProjects', 'setHasListedProjects'],
          },
          {
            target: 'Has no projects',
            actions: ['setProjects', 'setHasListedProjects'],
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

    'Creating file': {
      invoke: {
        id: 'create-file',
        src: 'createFile',
        input: ({ event, context }) => {
          if (event.type !== 'Import file from URL') {
            return {
              code: '',
              name: '',
              method: 'existingProject',
              projects: context.projects,
            }
          }
          return {
            code: event.data.code || '',
            name: event.data.name,
            method: event.data.method,
            projectName: event.data.projectName,
            projects: context.projects,
          }
        },
        onDone: {
          target: 'Reading projects',
          actions: ['navigateToFile', 'toastSuccess'],
        },
        onError: {
          target: 'Reading projects',
          actions: 'toastError',
        },
      },
    },
  },
})
