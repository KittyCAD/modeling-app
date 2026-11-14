import {
  clearSessionExpiredNotice,
  notifySessionExpired,
  notifySessionExpiredFromResponse,
  sessionExpiredNotice,
  type SessionExpiredSource,
} from '@src/lib/sessionExpired'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  clearSessionExpiredNotice()
  vi.unstubAllEnvs()
})

describe.each([
  { token: 'localhost', expires: false },
  { token: 'real-api-token', expires: true },
])('session expiration with $token', ({ token, expires }) => {
  it.each<SessionExpiredSource>([
    'fetch',
    'engine-websocket',
    'legacy-engine-websocket',
  ])('handles an unauthorized response from %s', (source) => {
    vi.stubEnv('VITE_ZOO_API_TOKEN', token)
    if (source === 'fetch')
      notifySessionExpiredFromResponse(new Response(null, { status: 401 }))
    else notifySessionExpired(source)
    expect(sessionExpiredNotice.value !== undefined).toBe(expires)
    if (expires) expect(sessionExpiredNotice.value?.source).toBe(source)
  })
})
