import { assign, setup, fromPromise } from 'xstate'
import { Models } from '@kittycad/lib'
import withBaseURL from '../lib/withBaseURL'
import { isDesktop } from 'lib/isDesktop'
import {
  VITE_KC_API_BASE_URL,
  VITE_KC_DEV_TOKEN,
  VITE_KC_SKIP_AUTH,
  DEV,
} from 'env'
import {
  getUser as getUserDesktop,
  readTokenFile,
  writeTokenFile,
} from 'lib/desktop'
import { COOKIE_NAME } from 'lib/constants'

const SKIP_AUTH = VITE_KC_SKIP_AUTH === 'true' && DEV

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
const persistedToken =
  VITE_KC_DEV_TOKEN ||
  getCookie(COOKIE_NAME) ||
  localStorage?.getItem(TOKEN_PERSIST_KEY) ||
  ''

export const authMachine = setup({
  types: {} as {
    context: UserContext
    events:
      | Events
      | {
          type: 'xstate.done.actor.check-logged-in'
          output: {
            user: Models['User_type']
            token: string
          }
        }
  },
  actions: {
    goToIndexPage: () => {},
    goToSignInPage: () => {},
  },
  actors: {
    getUser: fromPromise(({ input }: { input: { token?: string } }) =>
      getUser(input)
    ),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QEECuAXAFgOgMabFwGsBJAMwBkB7KGCEgOwGIIqGxsBLBgNyqI75CRALQAbGnRHcA2gAYAuolAAHKrE7pObZSAAeiAIwBmAEzYA7ABYAbAFZTcgBzGbN44adWANCACeiKbGdthypk4AnBFyVs6uQXYAvom+aFh4BMTk1LSQjExgAE6FVIXYKmIAhuhkpQC2GcLikpDSDPJKSCBqGlo6XQYIrk7YETYWctYRxmMWFk6+AUPj2I5OdjZyrnZOFmbJqRg4Ern0zDkABFQYHbo9mtoMuoOGFhHYxlZOhvbOsUGGRaIL4WbBONzWQxWYwWOx2H4HEBpY4tCAAeQwTEuskUd3UD36oEGIlMNlCuzk8Js0TcVisgP8iG2lmcGysb0mW3ByRSIAYVAgcF0yLxvUez0QIms5ImVJpNjpDKWxmw9PGdLh4Te00+iORjSylFRjFFBKeA0QThGQWcexMwWhniBCGiqrepisUVMdlszgieqO2BOdBNXXufXNRKMHtGVuphlJkXs4Wdriso2CCasdgipOidID6WDkAx6FNEYlCAT5jmcjrckMdj2b3GzpsjbBMVMWezDbGPMSQA */
  id: 'Auth',
  initial: 'checkIfLoggedIn',
  context: {
    token: persistedToken,
  },
  states: {
    checkIfLoggedIn: {
      id: 'check-if-logged-in',
      invoke: {
        src: 'getUser',
        input: ({ context }) => ({ token: context.token }),
        id: 'check-logged-in',
        onDone: [
          {
            target: 'loggedIn',
            actions: assign(({ context, event }) => ({
              user: event.output.user,
              token: event.output.token || context.token,
            })),
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
          actions: () => {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            if (isDesktop()) writeTokenFile('')
          },
        },
      },
    },
    loggedOut: {
      entry: ['goToSignInPage'],
      on: {
        'Log in': {
          target: 'checkIfLoggedIn',
          actions: assign({
            token: ({ event }) => {
              const token = event.token || ''
              return token
            },
          }),
        },
      },
    },
  },
  schema: { events: {} as { type: 'Log out' } | { type: 'Log in' } },
})

async function getUser(input: { token?: string }) {
  const token = await getAndSyncStoredToken(input)
  const url = withBaseURL('/user')
  const headers: { [key: string]: string } = {
    'Content-Type': 'application/json',
  }

  if (!token && isDesktop()) return Promise.reject(new Error('No token found'))
  if (token) headers['Authorization'] = `Bearer ${token}`

  if (SKIP_AUTH) {
    // For local tests
    if (localStorage.getItem('FORCE_NO_IMAGE')) {
      LOCAL_USER.image = ''
    }

    return {
      user: LOCAL_USER,
      token,
    }
  }

  const userPromise = !isDesktop()
    ? fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers,
      })
        .then((res) => res.json())
        .catch((err) => console.error('error from Browser getUser', err))
    : getUserDesktop(input.token ?? '', VITE_KC_API_BASE_URL)

  const user = await userPromise

  // Necessary here because we use Kurt's API key in CI
  if (localStorage.getItem('FORCE_NO_IMAGE')) {
    user.image = ''
  }

  if ('error_code' in user) return Promise.reject(new Error(user.message))

  return {
    user: user as Models['User_type'],
    token,
  }
}

function getCookie(cname: string): string | null {
  if (isDesktop()) {
    return null
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
  return null
}

async function getAndSyncStoredToken(input: {
  token?: string
}): Promise<string> {
  // dev mode
  if (VITE_KC_DEV_TOKEN) return VITE_KC_DEV_TOKEN

  const token =
    input.token && input.token !== ''
      ? input.token
      : getCookie(COOKIE_NAME) || localStorage?.getItem(TOKEN_PERSIST_KEY) || ''
  if (token) {
    // has just logged in, update storage
    localStorage.setItem(TOKEN_PERSIST_KEY, token)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    isDesktop() && writeTokenFile(token)
    return token
  }
  if (!isDesktop()) return ''
  const fileToken = isDesktop() ? await readTokenFile() : ''
  // prefer other above, but file will ensure login persists after app updates
  if (!fileToken) return ''
  // has token in file, update localStorage
  localStorage.setItem(TOKEN_PERSIST_KEY, fileToken)
  return fileToken
}
