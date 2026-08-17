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
