import { hasMasqueradeHint, watchSessionIdentity } from '@src/lib/masquerade'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('hasMasqueradeHint', () => {
  it('only recognizes the hint for the requested API environment', () => {
    const cookie = vi
      .spyOn(document, 'cookie', 'get')
      .mockReturnValue('__Secure-masquerade-zoo.dev=1')
    expect(hasMasqueradeHint('https://api.zoo.dev')).toBe(true)
    expect(hasMasqueradeHint('https://api.dev.zoo.dev')).toBe(false)
    cookie.mockRestore()
  })
})

describe('watchSessionIdentity', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('blocks the first stale interaction and reloads only once', () => {
    let identity = 'staff'
    const changed = vi.fn()
    const clicked = vi.fn()
    const stop = watchSessionIdentity(
      changed,
      () => false,
      () => identity
    )
    document.body.addEventListener('click', clicked)
    identity = 'customer'
    document.body.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )
    expect(changed).toHaveBeenCalledTimes(1)
    expect(clicked).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(changed).toHaveBeenCalledTimes(1)
    stop()
    document.body.removeEventListener('click', clicked)
  })

  it('waits for end/restore navigation and removes its listeners on cleanup', () => {
    let identity = 'customer'
    let paused = true
    const changed = vi.fn()
    const stop = watchSessionIdentity(
      changed,
      () => paused,
      () => identity
    )
    identity = 'staff'
    vi.advanceTimersByTime(500)
    expect(changed).not.toHaveBeenCalled()
    paused = false
    window.dispatchEvent(new Event('focus'))
    expect(changed).toHaveBeenCalledTimes(1)
    stop()
    window.dispatchEvent(new Event('focus'))
    expect(vi.getTimerCount()).toBe(0)
  })
})
