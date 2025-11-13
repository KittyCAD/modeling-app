import { renderHook } from '@testing-library/react'
import { useOnWindowOnlineOffline } from '@src/hooks/network/useOnWindowOnlineOffline'
import { vi } from 'vitest'

describe('useOnWindowOnlineOffline tests', () => {
  describe('on mounted', () => {
    test('should mount', () => {
      const close = vi.fn(() => 1)
      const connect = vi.fn(() => 2)
      const { unmount, result } = renderHook(() =>
        useOnWindowOnlineOffline({
          close,
          connect
        })
      )
      unmount()
    })
    test('should add and remove window event listeners', () => {
      const close = vi.fn(() => 1)
      const connect = vi.fn(() => 2)
      const spyAdd = vi.spyOn(window,'addEventListener')
      const spyRemove = vi.spyOn(window,'removeEventListener')
      const { unmount, result } = renderHook(() =>
        useOnWindowOnlineOffline({
          close,
          connect
        })
      )
      unmount()
      expect(spyAdd).toHaveBeenCalledTimes(2)
      expect(spyRemove).toHaveBeenCalledTimes(2)
      spyAdd.mockRestore()
      spyRemove.mockRestore()
    })
  })
})
