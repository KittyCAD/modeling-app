import {
  consumeSessionExpiredSignIn,
  requestSessionExpiredSignIn,
  sessionExpiredSignInIntent,
} from '@src/lib/sessionExpired'
import { afterEach, describe, expect, test } from 'vitest'

afterEach(() => {
  sessionExpiredSignInIntent.value = false
})

describe('session-expired sign-in intent', () => {
  test('is not pending by default', () => {
    expect(sessionExpiredSignInIntent.value).toBe(false)
    expect(consumeSessionExpiredSignIn()).toBe(false)
  })

  test('is readable once and then clears itself', () => {
    requestSessionExpiredSignIn()
    expect(sessionExpiredSignInIntent.value).toBe(true)

    expect(consumeSessionExpiredSignIn()).toBe(true)

    // The second reader must not act on it: this is what stops a remount of the
    // sign-in screen from starting a second device flow.
    expect(consumeSessionExpiredSignIn()).toBe(false)
    expect(sessionExpiredSignInIntent.value).toBe(false)
  })

  test('can be requested again after being consumed', () => {
    requestSessionExpiredSignIn()
    expect(consumeSessionExpiredSignIn()).toBe(true)

    requestSessionExpiredSignIn()
    expect(consumeSessionExpiredSignIn()).toBe(true)
  })
})
