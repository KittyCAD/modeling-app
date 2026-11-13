import { useIsOffline } from '@src/hooks/network/useIsOffline'
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

it('reads initial connectivity and follows disconnection and reconnection', () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const { result, unmount } = renderHook(useIsOffline)
  try {
    expect(result.current).toBe(true)
    act(() => {
      online.mockReturnValue(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe(false)
    act(() => {
      online.mockReturnValue(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(true)
  } finally {
    unmount()
    online.mockRestore()
  }
})
