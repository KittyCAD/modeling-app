import type { User } from '@kittycad/lib'
import { users, oauth2 } from '@kittycad/lib'
import env, {
  updateEnvironment,
  updateEnvironmentKittycadWebSocketUrl,
  generateDomainsFromBaseDomain,
} from '@src/env'
import { assign, fromPromise, setup } from 'xstate'
import {
  LEGACY_COOKIE_NAME,
  OAUTH2_DEVICE_CLIENT_ID,
  COOKIE_NAME_PREFIX,
} from '@src/lib/constants'
import { readEnvironmentConfigurationKittycadWebSocketUrl } from '@src/lib/desktop'
import {
  listAllEnvironments,
  readEnvironmentConfigurationToken,
  readEnvironmentFile,
  writeEnvironmentConfigurationToken,
  writeEnvironmentFile,
} from '@src/lib/desktop'
import { isDesktop } from '@src/lib/isDesktop'
import { createKCClient, kcCall } from '@src/lib/kcClient'
import { markOnce } from '@src/lib/performance'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import { ACTOR_IDS } from '@src/machines/machineConstants'

export interface UserContext {
  user?: User
  token: string
}

export type Events =
  | {
      type: 'Log out'
    }
  | {
      type: 'Log out all'
    }
  | {
      type: 'Log in'
      token?: string
    }

export const TOKEN_PERSIST_KEY = 'TOKEN_PERSIST_KEY'

/**
 * Determine which token do we have persisted to initialize the auth machine
 */
export const persistedToken = getTokenFromEnvOrCookie()
console.log('Initial persisted token')
console.table([
  ['cookie', !!getCookie()],
  ['api token', !!env().VITE_ZOO_API_TOKEN],
])

export const authMachine = setup({
  types: {} as {
    context: UserContext
    events:
      | Events
      | {
          type: 'xstate.done.actor.check-logged-in'
          output: {
            user: User
            token: string
          }
        }
  },
  actors: {
    getUser: fromPromise(({ input }: { input: { token?: string } }) =>
      getUser(input)
    ),
    logout: fromPromise(logout),
    logoutAllEnvironments: fromPromise(logoutAllEnvironments),
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
        'Log out all': {
          target: 'loggingOutAllEnvironments',
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
    loggingOutAllEnvironments: {
      invoke: {
        src: 'logoutAllEnvironments',
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
  if (window.electron) {
    const environment =
      (await readEnvironmentFile(window.electron)) ||
      env().VITE_ZOO_BASE_DOMAIN ||
      ''
    updateEnvironment(environment)

    // Update the WebSocket URL override
    const cachedKittycadWebSocketUrl =
      await readEnvironmentConfigurationKittycadWebSocketUrl(
        window.electron,
        environment
      )
    if (cachedKittycadWebSocketUrl) {
      updateEnvironmentKittycadWebSocketUrl(
        environment,
        cachedKittycadWebSocketUrl
      )
    }
  }

  let token = ''
  try {
    token = await getAndSyncStoredToken(input)
  } catch (e) {
    console.error(e)
  }
  const client = createKCClient(token)

  /**
   * We do not want to store a token or a user since the developer is running
   * the application and dependencies locally. They know what they are doing.
   */
  if (env().VITE_ZOO_API_TOKEN === 'localhost') {
    return {
      user: undefined,
      token: 'localhost',
    }
  }

  if (!token && isDesktop()) return Promise.reject(new Error('No token found'))

  const me = await kcCall(() => users.get_user_self({ client }))
  if (me instanceof Error) return Promise.reject(me)

  // Necessary here because we use Kurt's API key in CI
  if (localStorage.getItem('FORCE_NO_IMAGE')) {
    me.image = ''
  }

  markOnce('code/didAuth')
  return {
    user: me,
    token,
  }
}

export function getCookie(): string | null {
  if (isDesktop()) {
    return null
  }

  const baseDomain = env().VITE_ZOO_BASE_DOMAIN
  if (baseDomain === 'zoo.dev' || baseDomain === 'zoogov.dev') {
    return getCookieByName(LEGACY_COOKIE_NAME)
  } else {
    return getCookieByName(COOKIE_NAME_PREFIX + baseDomain)
  }
}

/**
 * Get token from environment variable or cookie.
 * This is a synchronous utility function that can be used in both
 * React hooks and non-React contexts (like singleton initialization).
 * @returns The token string, or empty string if neither source has a token
 */
export function getTokenFromEnvOrCookie(): string {
  const envToken = env().VITE_ZOO_API_TOKEN
  const cookieToken = getCookie()
  return envToken || cookieToken || ''
}

function getCookieByName(cname: string): string | null {
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
  // Local mode
  const localToken = env().VITE_ZOO_API_TOKEN
  if (localToken) {
    console.log('Token used for authentication')
    console.table([['api token', !!localToken]])
    return localToken
  }

  const environmentName = env().VITE_ZOO_BASE_DOMAIN

  // Find possible tokens
  const inputToken = input.token && input.token !== '' ? input.token : ''
  const cookieToken = getCookie()
  const fileToken =
    window.electron && environmentName
      ? await readEnvironmentConfigurationToken(
          window.electron,
          environmentName
        )
      : ''
  const token = inputToken || cookieToken || fileToken

  // Log what tokens we found
  console.log('Token used for authentication')
  console.table([
    ['persisted token', !!inputToken],
    ['cookie', !!cookieToken],
    ['api token', !!localToken],
    ['file token', !!fileToken],
  ])

  // If you found a token
  if (token) {
    // Write it to disk to sync it for desktop!
    if (window.electron) {
      // has just logged in, update storage
      if (environmentName)
        await writeEnvironmentConfigurationToken(
          window.electron,
          environmentName,
          token
        )
    }
    return token
  }

  // If you are web and you made it this far, you do not get a token
  if (!isDesktop()) return ''

  if (!fileToken) return ''
  // default desktop login workflow to always read from disk, file will ensure login persists after app updates
  return fileToken
}

/**
 * Logout function that will do a default logout within the AuthMachine
 */
async function logout() {
  return logoutEnvironment()
}

/**
 * Logout function that will do a specific environment logout if environment name is passed in
 */
async function logoutEnvironment(requestedDomain?: string) {
  // TODO: 7/10/2025 Remove this months from now, we want to clear the localStorage of the key.
  localStorage.removeItem(TOKEN_PERSIST_KEY)
  if (window.electron) {
    try {
      const domain = requestedDomain || env().VITE_ZOO_BASE_DOMAIN
      let token = ''
      if (domain) {
        token = await readEnvironmentConfigurationToken(window.electron, domain)
      } else {
        return new Error('Unable to logout, cannot find domain')
      }

      if (token) {
        try {
          const apiUrlBase = (() => {
            try {
              const u = new URL(domain)
              return u.origin
            } catch {
              const d = generateDomainsFromBaseDomain(domain)
              return d.API_URL
            }
          })()

          const client = createKCClient(token, apiUrlBase)
          await kcCall(() =>
            oauth2.oauth2_token_revoke({
              client,
              body: {
                token,
                client_id: OAUTH2_DEVICE_CLIENT_ID,
              },
            })
          )
        } catch (e) {
          console.error('Error revoking token:', e)
        }

        if (domain) {
          await writeEnvironmentConfigurationToken(window.electron, domain, '')
        }
        await writeEnvironmentFile(window.electron, '')
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

/**
 * To logout you need to revoke the token via the `oauth2/token/revoke` deleting the token off disk for electron
 * will not be sufficient.
 */
async function logoutAllEnvironments() {
  if (!window.electron) {
    return new Error('unimplemented for web')
  }
  const environments = await listAllEnvironments(window.electron)
  for (let i = 0; i < environments.length; i++) {
    const environmentName = environments[i]
    // Make the oauth2/token/revoke request per environment
    await logoutEnvironment(environmentName)
  }
}
