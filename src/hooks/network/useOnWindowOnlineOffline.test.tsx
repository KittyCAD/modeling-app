import { renderHook } from '@testing-library/react'
import { useOnWindowOnlineOffline } from '@src/hooks/network/useOnWindowOnlineOffline'
import { vi } from 'vitest'

describe('useOnWindowOnlineOffline', () => {
  describe('on mounted', () => {
    test('should mount', () => {
      const close = vi.fn(() => 1)
      const connect = vi.fn(() => 2)
      const { unmount } = renderHook(() =>
        useOnWindowOnlineOffline({
          close,
          connect,
        })
      )
      unmount()
      expect(close).toHaveBeenCalledTimes(0)
      expect(connect).toHaveBeenCalledTimes(0)
    })
    test('should add and remove window event listeners', () => {
      const close = vi.fn(() => 1)
      const connect = vi.fn(() => 2)
      const spyAdd = vi.spyOn(window, 'addEventListener')
      const spyRemove = vi.spyOn(window, 'removeEventListener')
      const { unmount } = renderHook(() =>
        useOnWindowOnlineOffline({
          close,
          connect,
        })
      )
      unmount()
      expect(spyAdd).toHaveBeenCalledTimes(2)
      expect(spyRemove).toHaveBeenCalledTimes(2)
      spyAdd.mockRestore()
      spyRemove.mockRestore()
    })
    test('should be called with offline and online', () => {
      const close = vi.fn(() => 1)
      const connect = vi.fn(() => 2)
      const spyAdd = vi.spyOn(window, 'addEventListener')
      const spyRemove = vi.spyOn(window, 'removeEventListener')
      const { unmount } = renderHook(() =>
        useOnWindowOnlineOffline({
          close,
          connect,
        })
      )
      unmount()
      expect(spyAdd).toHaveBeenCalledTimes(2)
      expect(spyRemove).toHaveBeenCalledTimes(2)
      expect(spyAdd).toHaveBeenNthCalledWith(1, 'offline', expect.any(Function))
      expect(spyAdd).toHaveBeenNthCalledWith(2, 'online', expect.any(Function))
      expect(spyRemove).toHaveBeenNthCalledWith(
        1,
        'offline',
        expect.any(Function)
      )
      expect(spyRemove).toHaveBeenNthCalledWith(
        2,
        'online',
        expect.any(Function)
      )
      spyAdd.mockRestore()
      spyRemove.mockRestore()
    })
    test('should call close', () => {
      const close = vi.fn(() => 1)
      const connect = vi.fn(() => 2)
      const { unmount } = renderHook(() =>
        useOnWindowOnlineOffline({
          close,
          connect,
        })
      )
      window.dispatchEvent(new Event('offline'))
      unmount()
      expect(close).toHaveBeenCalledTimes(1)
    })
    test('should not call close since the event type is resize', () => {
      const close = vi.fn(() => 1)
      const connect = vi.fn(() => 2)
      const { unmount } = renderHook(() =>
        useOnWindowOnlineOffline({
          close,
          connect,
        })
      )
      window.dispatchEvent(new Event('resize'))
      unmount()
      expect(close).toHaveBeenCalledTimes(0)
    })
    test('should call close 3 times', () => {
      const close = vi.fn(() => 1)
      const connect = vi.fn(() => 2)
      const { unmount } = renderHook(() =>
        useOnWindowOnlineOffline({
          close,
          connect,
        })
      )
      window.dispatchEvent(new Event('offline'))
      window.dispatchEvent(new Event('offline'))
      window.dispatchEvent(new Event('offline'))
      unmount()
      expect(close).toHaveBeenCalledTimes(3)
    })
    test('should call connect', () => {
      const close = vi.fn(() => 1)
      const connect = vi.fn(() => 2)
      const { unmount } = renderHook(() =>
        useOnWindowOnlineOffline({
          close,
          connect,
        })
      )
      window.dispatchEvent(new Event('online'))
      unmount()
      expect(connect).toHaveBeenCalledTimes(1)
    })
    test('should not call connect since the event type is resize', () => {
      const close = vi.fn(() => 1)
      const connect = vi.fn(() => 2)
      const { unmount } = renderHook(() =>
        useOnWindowOnlineOffline({
          close,
          connect,
        })
      )
      window.dispatchEvent(new Event('resize'))
      unmount()
      expect(connect).toHaveBeenCalledTimes(0)
    })
    test('should call connect 3 times', () => {
      const close = vi.fn(() => 1)
      const connect = vi.fn(() => 2)
      const { unmount } = renderHook(() =>
        useOnWindowOnlineOffline({
          close,
          connect,
        })
      )
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('online'))
      unmount()
      expect(connect).toHaveBeenCalledTimes(3)
    })
  })
})
