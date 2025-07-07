import type { Models } from '@kittycad/lib'
import env, { updateEnvironment } from '@src/env'
import { assign, fromPromise, setup } from 'xstate'

import { COOKIE_NAME, OAUTH2_DEVICE_CLIENT_ID } from '@src/lib/constants'
import {
  getUser as getUserDesktop,
  readEnvironmentFile,
  readTokenFile,
  writeEnvironmentFile,
  writeTokenFile,
} from '@src/lib/desktop'
import { isDesktop } from '@src/lib/isDesktop'
import { markOnce } from '@src/lib/performance'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import { ACTOR_IDS } from '@src/machines/machineConstants'

export interface UserContext {
  user?: Models['User_type']
  token: string
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

/**
 * Determine which token do we have persisted to initialize the auth machine
 */
const persistedCookie = getCookie(COOKIE_NAME)
const persistedLocalStorage = localStorage?.getItem(TOKEN_PERSIST_KEY) || ''
const persistedDevToken = env().VITE_KITTYCAD_API_TOKEN
export const persistedToken =
  persistedDevToken || persistedCookie || persistedLocalStorage
console.log('Initial persisted token')
console.table([
  ['cookie', !!persistedCookie],
  ['local storage', !!persistedLocalStorage],
  ['api token', !!persistedDevToken],
])

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
    logout: fromPromise(logout),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QEECuAXAFgOgMabFwGsBJAMwBkB7KGCEgOwGIIqGxsBLBgNyqI75CRALQAbGnRHcA2gAYAuolAAHKrE7pObZSAAeiAIwAWQ9gBspuQCYAnAGYAHPYCsx+4ccAaEAE9E1q7YcoZyxrYR1m7mcrYAvnE+aFh4BMTk1LSQjExgAE55VHnYKmIAhuhkRQC2qcLikpDSDPJKSCBqGlo67QYI9gDs5tge5o6h5vau7oY+-v3mA9jWco4u5iu21ua2YcYJSRg4Eln0zJkABFQYrbqdmtoMun2GA7YjxuPmLqvGNh5zRCfJaOcyLUzuAYuFyGcwHEDJY6NCAAeQwTEuskUd3UDx6oD6Im2wUcAzkMJ2cjBxlMgIWLmwZLWljecjJTjh8IYVAgcF0iJxXUez0QIgGxhJZIpu2ptL8AWwtje1nCW2iq1shns8MRdXSlGRjEFeKevUQjkcy3sqwGHimbg83nlCF22GMytVUWMMUc8USCKO2BOdCN7Xu3VNBKMKsVFp2hm2vu+1id83slkVrgTxhcW0pNJ1geDkDR6GNEZFCAT1kZZLk9cMLltb0WdPMjewjjC1mzOZCtk5CSAA */
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
  const environment = await readEnvironmentFile()
  updateEnvironment(environment)
  const url = withAPIBaseURL('/user')
  const headers: { [key: string]: string } = {
    'Content-Type': 'application/json',
  }

  if (!token && isDesktop()) return Promise.reject(new Error('No token found'))
  if (token) headers['Authorization'] = `Bearer ${token}`

  const userPromise = isDesktop()
    ? getUserDesktop(token)
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

export function getCookie(cname: string): string | null {
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
  const VITE_KITTYCAD_API_TOKEN = env().VITE_KITTYCAD_API_TOKEN
  if (VITE_KITTYCAD_API_TOKEN) {
    console.log('Token used for authentication')
    console.table([['api token', !!VITE_KITTYCAD_API_TOKEN]])
    return VITE_KITTYCAD_API_TOKEN
  }

  const inputToken = input.token && input.token !== '' ? input.token : ''
  const cookieToken = getCookie(COOKIE_NAME)
  const localStorageToken = localStorage?.getItem(TOKEN_PERSIST_KEY) || ''
  const token = inputToken || cookieToken || localStorageToken

  console.log('Token used for authentication')
  console.table([
    ['persisted token', !!inputToken],
    ['cookie', !!cookieToken],
    ['local storage', !!localStorageToken],
    ['api token', !!VITE_KITTYCAD_API_TOKEN],
  ])
  if (token) {
    if (isDesktop()) {
      // has just logged in, update storage
      localStorage.setItem(TOKEN_PERSIST_KEY, token)
      await writeTokenFile(token)
    }
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
  if (isDesktop()) {
    try {
      let token = await readTokenFile()

      if (token) {
        try {
          await fetch(withAPIBaseURL('/oauth2/token/revoke'), {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              token: token,
              client_id: OAUTH2_DEVICE_CLIENT_ID,
            }).toString(),
          })
        } catch (e) {
          console.error('Error revoking token:', e)
        }

        await writeTokenFile('')
        await writeEnvironmentFile('')
        return Promise.resolve(null)
      }
    } catch (e) {
      console.error('Error reading token during logout (ignoring):', e)
    }
  }

  return fetch(withAPIBaseURL('/logout'), {
    method: 'POST',
    credentials: 'include',
  })
}
