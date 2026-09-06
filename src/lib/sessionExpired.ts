import { signal } from '@preact/signals-core'

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

/**
 * A one-shot intent to begin desktop sign-in as soon as the sign-in screen is
 * reached, set when the user picks "Sign in again" in the session-expired
 * dialog.
 *
 * This is application state, not route state. It has no URL representation, so
 * carrying it in `history.state` made the router the owner of something the
 * router cannot express — and made it invisible to anything that did not go
 * through a navigation.
 */
export const sessionExpiredSignInIntent = signal(false)

export function requestSessionExpiredSignIn() {
  sessionExpiredSignInIntent.value = true
}

/**
 * Read the intent and clear it in one step, so two readers cannot both act on
 * it. Returns whether it was pending.
 */
export function consumeSessionExpiredSignIn() {
  const pending = sessionExpiredSignInIntent.peek()
  if (pending) {
    sessionExpiredSignInIntent.value = false
  }
  return pending
}

/** Mark auth as expired after an app-owned Zoo API request receives a 401. */
export function notifySessionExpiredFromResponse(response: Response) {
  if (response.status === 401) {
    notifySessionExpired('fetch')
  }
}

/** Fetch through the app-owned Zoo API boundary without replacing global fetch. */
export async function fetchWithSessionExpiration(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const response = await fetch(input, init)
  notifySessionExpiredFromResponse(response)
  return response
}
