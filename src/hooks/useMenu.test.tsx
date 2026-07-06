import { useMenuListener } from '@src/hooks/useMenu'
import type { WebContentSendPayload } from '@src/menu/channels'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

describe('useMenuListener', () => {
  const originalElectron = window.electron

  afterEach(() => {
    window.electron = originalElectron
    vi.restoreAllMocks()
  })

  test('handles menu actions with the latest callback after rerender', () => {
    let registeredCallback:
      | ((payload: WebContentSendPayload) => void)
      | undefined
    const removeListener = vi.fn()
    const menuOn = vi.fn(
      (callback: (payload: WebContentSendPayload) => void) => {
        registeredCallback = callback
        return removeListener
      }
    )
    window.electron = { menuOn } as unknown as Window['electron']

    const firstCallback = vi.fn()
    const latestCallback = vi.fn()
    const menuAction = {
      menuLabel: 'File.Preferences.User settings',
    } satisfies WebContentSendPayload

    const { rerender, unmount } = renderHook(
      ({ callback }) => useMenuListener(callback),
      { initialProps: { callback: firstCallback } }
    )

    rerender({ callback: latestCallback })
    act(() => registeredCallback?.(menuAction))

    expect(menuOn).toHaveBeenCalledTimes(1)
    expect(firstCallback).not.toHaveBeenCalled()
    expect(latestCallback).toHaveBeenCalledWith(menuAction)

    unmount()
    expect(removeListener).toHaveBeenCalledTimes(1)
  })
})
