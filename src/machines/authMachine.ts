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
import { markOnce } from 'lib/performance'
import { ACTOR_IDS } from './machineConstants'
import withBaseUrl from '../lib/withBaseURL'

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
export const persistedToken =
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
  actors: {
    getUser: fromPromise(({ input }: { input: { token?: string } }) =>
      getUser(input)
    ),
    logout: fromPromise(async () =>
      isDesktop() ? writeTokenFile('') : logout()
    ),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QAoC2BDAxgCwJYDswBKAOhzEwGsBJAMwBkB7KGCa-AYgkcJIIDdGlMGWwVKAWgA2zVhIIBtAAwBdRKAAOjWLgAuuHupAAPRAGYArAEYSADgu2AnGYBMLpVYBsZz7YA0IACeiG6OJM62tmZKLgDsno5KtvEAvikBaFh4hKTkVHRMLJDsHGAATmWMZSQaUui6tFWoouLSspDy+MpqSCBaOvqGvaYIljb2Tq7uXj7+QYgALFYW4clWy1ZmVgsWsZtpGRg4BMQkMkVsnIUABIwArrrdRv16BvhGI74LJBYW7o5WKJmKILObBUZeEgJP4LTxKMwIhZmBYLA4gTLHHJnWQEKAAeQeXB4IgEQhEGOyp3OUFxBN0CFJmHqb26T16L0G72GiCsSg8PyszkBCViTiUjgC4Jcnhc4SUsQcvgsoL2VjRFJOpGptMJ5Uq1Vq9UaZWaGqx2vw+IeDPwgiZnNZqme2leQ1An1s31+-0BCJBYJCLm+lk8CRl9hRyos6qOlK17QgdI4N0UTvZLs5Hx58NsJARuys0tDSl+AYQthsgNi0TMqt2LjVaPwjAgcCMZuIzoGbyzCAknkliH7Maympa+QYCfYXddXPdixcg4QvKUdk2u2iLkcsXhCRHmKpU7nfQzPe5CAsMpIXi8MvFKM8VliS5c1jzj53W3isNFqPS6NjMcLStXQZ0zc8ohsJI-kcFxXEcR9HAWF9gTzDxbCUXxAQWEsdn3ONsQuOkwLPedl22MIzFg3YP1gl9PG+bYvGsSxlUcRJozSFIgA */
  id: ACTOR_IDS.AUTH,
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
      on: {
        'Log out': {
          target: 'loggingOut',
        },
      },
    },
    loggingOut: {
      invoke: {
        src: 'logout',
        onDone: 'loggedOut',
        onError: {
          target: 'loggedIn',
          actions: [
            ({ event }) => {
              console.error(
                'Error while logging out',
                'error' in event ? `: ${event.error}` : ''
              )
            },
          ],
        },
      },
    },
    loggedOut: {
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

    markOnce('code/didAuth')
    return {
      user: LOCAL_USER,
      token,
    }
  }

  const userPromise = isDesktop()
    ? getUserDesktop(token, VITE_KC_API_BASE_URL)
    : fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers,
      })
        .then((res) => res.json())
        .catch((err) => console.error('error from Browser getUser', err))

  const user = await userPromise

  // Necessary here because we use Kurt's API key in CI
  if (localStorage.getItem('FORCE_NO_IMAGE')) {
    user.image = ''
  }

  if ('error_code' in user) return Promise.reject(new Error(user.message))

  markOnce('code/didAuth')
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

async function logout() {
  localStorage.removeItem(TOKEN_PERSIST_KEY)
  if (isDesktop()) return Promise.resolve(null)
  return fetch(withBaseUrl('/logout'), {
    method: 'POST',
    credentials: 'include',
  })
}
