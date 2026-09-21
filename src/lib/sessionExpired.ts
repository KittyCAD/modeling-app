import { signal } from '@preact/signals-core'
import env, { onEnvironmentDomainChange } from '@src/env'
import { isDesktop } from '@src/lib/isDesktop'
import type { AuthRegistryService } from '@src/registry/contracts/auth'

type AuthenticatedSession = {
  token: string
  baseUrl: string | undefined
  userId: string | undefined
}

// Object identity distinguishes successive logins, even with the same token.
const authenticatedSession = signal<AuthenticatedSession | undefined>(undefined)

export const getAuthenticatedSession = () => authenticatedSession.peek()
export const subscribeToAuthenticatedSession = (
  listener: (session: AuthenticatedSession | undefined) => void
) => authenticatedSession.subscribe(listener)

export function initializeAuthSessionTracking(
  state: AuthRegistryService['state']
) {
  const updateSession = () => {
    const snapshot = state.peek()
    if (!snapshot.matches('loggedIn')) {
      authenticatedSession.value = undefined
      return
    }

    const token = snapshot.context.token
    const userId = snapshot.context.user?.id
    const baseUrl = env().VITE_ZOO_API_BASE_URL
    const previous = authenticatedSession.peek()
    if (
      !previous ||
      previous.token !== token ||
      previous.userId !== userId ||
      previous.baseUrl !== baseUrl
    ) {
      authenticatedSession.value = { token, userId, baseUrl }
    }
  }
  const unsubscribeFromAuth = state.subscribe(updateSession)
  const unsubscribeFromEnvironment = onEnvironmentDomainChange(updateSession)
  return () => {
    unsubscribeFromAuth()
    unsubscribeFromEnvironment()
    authenticatedSession.value = undefined
  }
}

export type SessionExpiredSource =
  | 'fetch'
  | 'engine-websocket'
  | 'legacy-engine-websocket'
  | 'unknown'

export type SessionExpiredNotice = {
  source: SessionExpiredSource
  detectedAt: number
}

export const sessionExpiredNotice = signal<SessionExpiredNotice | undefined>(
  undefined
)

export function notifySessionExpired(source: SessionExpiredSource = 'unknown') {
  const notice: SessionExpiredNotice = {
    source,
    detectedAt: Date.now(),
  }

  sessionExpiredNotice.value = notice
}

export function clearSessionExpiredNotice() {
  sessionExpiredNotice.value = undefined
}

/** Only a request belonging to the current authenticated session can expire it. */
export function notifySessionExpiredFromResponse(
  response: Response,
  requestSession: AuthenticatedSession | undefined
) {
  if (
    response.status === 401 &&
    requestSession &&
    requestSession === getAuthenticatedSession()
  ) {
    notifySessionExpired('fetch')
  }
}

/** Fetch through the app-owned Zoo API boundary without replacing global fetch. */
export async function fetchWithSessionExpiration(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const session = getAuthenticatedSession()
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  )
  const authorization = headers.get('Authorization')
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    typeof window === 'undefined' ? undefined : window.location.href
  )
  const credentials =
    init?.credentials ??
    (input instanceof Request ? input.credentials : 'same-origin')
  const usesCookies =
    !isDesktop() &&
    (credentials === 'include' ||
      (credentials === 'same-origin' &&
        typeof window !== 'undefined' &&
        url.origin === window.location.origin))
  const requestSession =
    session &&
    session.baseUrl &&
    url.origin === new URL(session.baseUrl).origin &&
    (authorization ? authorization === `Bearer ${session.token}` : usesCookies)
      ? session
      : undefined
  const response = await fetch(input, init)
  notifySessionExpiredFromResponse(response, requestSession)
  return response
}
