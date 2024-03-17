import { ProjectWithEntryPointMetadata } from 'lib/types'
import { assign, fromCallback, fromPromise, setup } from 'xstate'
import { settingsMachine } from './settingsMachine'
import { commandBarMachine } from './commandBarMachine'
import { homeMachine } from './homeMachine'
import { modelingMachine } from './modelingMachine'
import { fileMachine } from './fileMachine'
import { useLocation, useNavigate } from 'react-router-dom'
import { TOKEN_PERSIST_KEY, getUser, persistedToken } from './authMachine'
import { Models } from '@kittycad/lib/dist/types/src'
import { createActorContext } from '@xstate/react'
import { paths } from 'lib/paths'
import { isTauri } from 'lib/isTauri'
import { sep } from '@tauri-apps/api/path'

export const appMachine = setup({
  types: {
    context: {} as {
      token?: string
      user?: Models['User_type']
      currentProject?: ProjectWithEntryPointMetadata
      currentFile?: string
      navigate: ReturnType<typeof useNavigate>
      location: ReturnType<typeof useLocation>
    },
    events: {} as
      | { type: 'Sign out' }
      | {
          type: 'Open project'
          data: {
            project: ProjectWithEntryPointMetadata
            file: string
          }
        }
      | { type: 'Close project' }
      | { type: 'AuthActor.done'; output: Models['User_type'] },
    input: {} as {
      navigate: ReturnType<typeof useNavigate>
      location: ReturnType<typeof useLocation>
    },
  },
  actions: {
    'Clear currentProject and currentFile': assign({
      currentProject: undefined,
      currentFile: undefined,
    }),
    'Set currentProject': assign({
      currentProject: ({ event, context }) =>
        event.type === 'Open project'
          ? event.data.project
          : context.currentProject,
    }),
    'Set currentFile': assign({
      currentFile: ({ event, context }) =>
        event.type === 'Open project' ? event.data.file : context.currentFile,
    }),
    'Delete auth state': () => {
      localStorage.removeItem(TOKEN_PERSIST_KEY)
      assign({ token: undefined })
    },
    'Go to sign in page': ({ context }) => {
      context.navigate(paths.SIGN_IN)
    },
    'Navigate home': ({ context }) => {
      context.navigate(paths.INDEX)
    },
    'Navigate to file': ({ context, event }) => {
      if (event.type !== 'Open project') return
      context.navigate(
        paths.FILE +
          event.data.project.path +
          (isTauri() ? sep : '/') +
          event.data.file
      )
    },
    'Assign user': assign({
      user: ({ event, context }) =>
        event.type === 'AuthActor.done' ? event.output : context.user,
    }),
    'Persist auth state': ({ context }) => {
      localStorage.setItem(TOKEN_PERSIST_KEY, context.token || '')
    },
  },
  actors: {
    SettingsActor: settingsMachine,
    EngineConnectionActor: fromCallback(({ sendBack, receive, input }) => {
      // TODO implement actor
    }),
    CommandBarMachine: commandBarMachine,
    LspActor: fromCallback(({ sendBack, receive }) => {
      // TODO implement actor
    }),
    HomeMachine: homeMachine,
    ModelingMachine: modelingMachine,
    ClientSideSceneActor: fromCallback(({ sendBack, receive }) => {
      // TODO implement actor
    }),
    ProjectMachine: fileMachine,
    KclActor: fromCallback(({ sendBack, receive }) => {
      // TODO implement actor
    }),
    AuthActor: fromPromise(
      ({ input }: { input: { token: string | undefined } }) =>
        getUser(input.token)
    ),
  },
  schemas: {
    events: {
      'Sign out': {
        type: 'object',
        properties: {},
      },
      'Open project': {
        type: 'object',
        properties: {},
      },
      'Close project': {
        type: 'object',
        properties: {},
      },
      '': {
        type: 'object',
        properties: {},
      },
    },
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QEEAOqAEBZAhgYwAsBLAOzADoBlIqMiDUgYmtowHsBXAFwG0AGALqJQqNrCJcibEsJAAPRADYA7AEZyAFgCcG1QGZVygKyKAHMq3KANCACeiAExH1WvUY2Lnejct0a9AL4BNmiYuISkFCx0DCTkABJsALZgjADyqGAkGKgATmwAVmB4vIKyouKS0rIKCNp85A7KTnxqGq3m5jb2CMqKeuSWWqYjfKoeRmNBIejY+MRkVDQxpOQACvlFJeyZJIwAwgA2YmA5m8WlQkggFRJSMte19ZqqRsp6fHqKfIqq-UbdJRmcjKPjOZymVRaMHvaYgUJzCKLAAybBwEFIUEYEGkFFIADc2ABrCg4bgEfhXERiO7VR6IPTecimLRGYbDIymTyqUyAhAORSKcitVw8zx6Bx6ZpwhHhBYUVHozGMMC5fK5cioQ44LgAMzYuSS5DJXApZWutyqD1AtSMDgc5E8fW0ouUfQcfIcP00GhZpl90PeziCwRAJDYEDgsll80i5RpVpqiAAtEZGhpJkY3F8+KZc74+ao+Bphe1-VL-Vm+PaZbM5ZElrRILF45V7km6g7jNoPB49FooaoBXyNA5TMKVHxi99jO5VLWwrHFtFm6tEilW7TrfJENCQe4dIo+wOB3o+YphsLWu0s8NfK4F4j5Y2VnENoULjsspvE-Tev2r3GAV70FFRz3aRpWiPHwtCcBxVHnUMYyRKJlmbTguB-ds-yHBDyCze1OhUe1jE9PN8OcdpvFeBCL0fesUTRDESCgLC6RtRBJkGJoswQ0EuXaaw7EQQdyC+KVQW+b4Pg0EMAiAA */
  context: ({ input }) => ({
    token: persistedToken,
    navigate: input.navigate,
    location: input.location,
  }),
  id: 'App Machine',
  initial: 'Loading',
  states: {
    'Signed in': {
      initial: 'Home',
      on: {
        'Sign out': {
          target: 'Signed out',
          actions: [
            {
              type: 'Delete auth state',
            },
            {
              type: 'Go to sign in page',
            },
          ],
        },
      },
      invoke: [
        {
          id: 'settings',
          systemId: 'settings',
          input: {},
          src: 'SettingsActor',
        },
        {
          id: 'engine',
          systemId: 'engine',
          input: {},
          src: 'EngineConnectionActor',
        },
        {
          id: 'commands',
          systemId: 'commands',
          input: {},
          src: 'CommandBarMachine',
        },
        {
          id: 'lsp',
          systemId: 'lsp',
          input: {},
          src: 'LspActor',
        },
      ],
      states: {
        Home: {
          on: {
            'Open project': {
              target: 'Project open',
              actions: {
                type: 'Navigate to file',
              },
            },
          },
          entry: {
            type: 'Clear currentProject and currentFile',
          },
          invoke: {
            id: 'home',
            input: {},
            src: 'HomeMachine',
          },
        },
        'Project open': {
          on: {
            'Close project': {
              target: 'Home',
              actions: {
                type: 'Navigate home',
              },
            },
          },
          entry: [
            {
              type: 'Set currentProject',
            },
            {
              type: 'Set currentFile',
            },
          ],
          invoke: [
            {
              id: 'modeling',
              systemId: 'modeling',
              input: {},
              src: 'ModelingMachine',
            },
            {
              input: {},
              src: 'ClientSideSceneActor',
            },
            {
              id: 'project',
              systemId: 'project',
              input: {},
              src: 'ProjectMachine',
            },
            {
              input: {},
              src: 'KclActor',
            },
          ],
        },
      },
    },

    'Signed out': {
      type: 'final',
    },

    Loading: {
      invoke: {
        src: 'AuthActor',
        id: 'auth',
        input: ({ context: { token } }) => ({ token }),
        onDone: {
          target: 'Signed in',
          actions: [
            assign({
              user: ({ event }) => event.output,
            }),
            'Persist auth state',
          ],
        },
        onError: 'Signed out',
      },
    },
  },
})

export const AppMachineContext = createActorContext(appMachine)
