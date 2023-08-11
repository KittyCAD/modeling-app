import { createMachine, assign } from 'xstate'
import { Models } from '@kittycad/lib'
import withBaseURL from '../lib/withBaseURL'

export interface UserContext {
  user?: Models['User_type']
  token?: string
}

export type Events =
  | {
      type: 'logout'
    }
  | {
      type: 'tryLogin'
      token?: string
    }

export const TOKEN_PERSIST_KEY = 'TOKEN_PERSIST_KEY'
const persistedToken = localStorage?.getItem(TOKEN_PERSIST_KEY) || ''

export const authMachine = createMachine<UserContext, Events>(
  {
    id: 'Auth',
    initial: 'checkIfLogedIn',
    states: {
      checkIfLogedIn: {
        id: 'check-if-loged-in',
        invoke: {
          src: 'getUser',
          id: 'check-loged-in',
          onDone: [
            {
              target: 'logedIn',
              actions: assign({
                user: (context, event) => event.data,
              }),
            },
          ],
          onError: [
            {
              target: 'logedOut',
              actions: assign({
                user: () => undefined,
              }),
            },
          ],
        },
      },
      logedIn: {
        entry: ['goToIndexPage'],
        on: {
          logout: {
            target: 'logedOut',
          },
        },
      },
      logedOut: {
        entry: ['goToSignInPage'],
        on: {
          tryLogin: {
            target: 'checkIfLogedIn',
            actions: assign({
              token: (context, event) => {
                const token = event.token || ''
                localStorage.setItem(TOKEN_PERSIST_KEY, token)
                return token
              },
            }),
          },
        },
      },
    },
    schema: { events: {} as { type: 'logout' } | { type: 'tryLogin' } },
    predictableActionArguments: true,
    preserveActionOrder: true,
    context: { token: persistedToken },
  },
  {
    actions: {},
    services: { getUser },
    guards: {},
    delays: {},
  }
)

async function getUser(context: UserContext) {
  const url = withBaseURL('/user')
  const headers: { [key: string]: string } = {
    'Content-Type': 'application/json',
  }
  if (!context.token && '__TAURI__' in window) throw 'not log in'
  if (context.token) headers['Authorization'] = `Bearer ${context.token}`
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers,
  })
  const user = await response.json()
  if ('error_code' in user) throw new Error(user.message)
  return user
}
