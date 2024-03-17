import { createMachine, assign, setup, fromPromise } from 'xstate'
import { Models } from '@kittycad/lib'
import withBaseURL from '../lib/withBaseURL'
import { isTauri } from 'lib/isTauri'
import { invoke } from '@tauri-apps/api'
import { VITE_KC_API_BASE_URL } from 'env'

const SKIP_AUTH =
  import.meta.env.VITE_KC_SKIP_AUTH === 'true' && import.meta.env.DEV
const LOCAL_USER: Models['User_type'] = {
  id: '8675309',
  name: 'Test User',
  email: 'kittycad.sidebar.test@example.com',
  image: 'https://placekitten.com/200/200',
  created_at: 'yesteryear',
  updated_at: 'today',
  company: 'Test Company',
  discord: 'Test User#1234',
  github: 'testuser',
  phone: '555-555-5555',
  first_name: 'Test',
  last_name: 'User',
  can_train_on_data: false,
  is_service_account: false,
}

export interface UserContext {
  user?: Models['User_type']
  token?: string
}

export type Events =
  | {
      type: 'Log out'
    }
  | {
      type: 'Log in'
      token?: string
    }

export const TOKEN_PERSIST_KEY = 'TOKEN_PERSIST_KEY'
export const persistedToken =
  localStorage?.getItem(TOKEN_PERSIST_KEY) ||
  getCookie('__Secure-next-auth.session-token') ||
  undefined

export const authMachine = setup({
  types: {
    events: {} as { type: 'Log out' } | { type: 'Log in' },
    context: {} as UserContext,
  },
  actors: {
    fetchUser: fromPromise(({ input }: { input: { token: string | undefined }}) => getUser(input.token)),
  },
  actions: {
    goToIndexPage: () => ({}),
    goToSignInPage: () => ({}),
  }
}).createMachine({
  id: 'Auth',
  preserveActionOrder: true,
  initial: 'checkIfLoggedIn',
  context: {
    token: persistedToken,
  },
  states: {
    checkIfLoggedIn: {
      id: 'check-if-logged-in',
      invoke: {
        id: 'getUser',
        src: 'fetchUser',
        input: ({ context: { token } }) => ({ token }),
        onDone: [
          {
            target: 'loggedIn',
            actions: assign({
              user: ({ event }) => event.output,
            }),
          },
        ],
        onError: [
          {
            target: 'loggedOut',
            actions: assign({
              user: () => undefined,
            }),
          },
        ],
      },
    },
    loggedIn: {
      entry: ['goToIndexPage'],
      on: {
        'Log out': {
          target: 'loggedOut',
        },
      },
    },
    loggedOut: {
      entry: { type: 'goToIndexPage' },
      on: {
        'Log in': {
          target: 'checkIfLoggedIn',
        },
      },
    },
  },
})

export async function getUser(token?: string) {
  const url = withBaseURL('/user')
  const headers: { [key: string]: string } = {
    'Content-Type': 'application/json',
  }

  if (!token && isTauri()) throw new Error('No token found')
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (SKIP_AUTH) return LOCAL_USER

  const userPromise = !isTauri()
    ? fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers,
      })
        .then((res) => res.json())
        .catch((err) => console.error('error from Browser getUser', err))
    : invoke<Models['User_type'] | Record<'error_code', unknown>>('get_user', {
        token: token,
        hostname: VITE_KC_API_BASE_URL,
      }).catch((err) => console.error('error from Tauri getUser', err))

  const user = await userPromise

  if ('error_code' in user) throw new Error(user.message)

  return user as Models['User_type']
}

export function getCookie(cname: string): string {
  if (isTauri()) {
    return ''
  }

  let name = cname + '='
  let decodedCookie = decodeURIComponent(document.cookie)
  let ca = decodedCookie.split(';')
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i]
    while (c.charAt(0) === ' ') {
      c = c.substring(1)
    }
    if (c.indexOf(name) === 0) {
      return c.substring(name.length, c.length)
    }
  }
  return ''
}
