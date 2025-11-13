import { renderHook } from '@testing-library/react'
import { useOnOfflineToExitSketchMode } from '@src/hooks/network/useOnOfflineToExitSketchMode'
import { vi } from 'vitest'
import { ConnectionManager } from '@src/network/connectionManager'
import { EngineConnectionEvents } from '@src/network/utils'

describe('useOnOfflineToExitSketchMode tests', () => {
  describe('on mounted', () => {
    test('should do nothing', () => {
      const callback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const { unmount } = renderHook(() =>
        useOnOfflineToExitSketchMode({
          callback,
          engineCommandManager,
        })
      )
      unmount()
      expect(callback).toHaveBeenCalledTimes(0)
    })
    test('should add and remove offline listener on engine command manager', () => {
      const callback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const spyAdd = vi.spyOn(engineCommandManager, 'addEventListener')
      const spyRemove = vi.spyOn(engineCommandManager, 'removeEventListener')

      const { unmount } = renderHook(() =>
        useOnOfflineToExitSketchMode({
          callback,
          engineCommandManager,
        })
      )
      unmount()
      expect(callback).toHaveBeenCalledTimes(0)
      expect(spyAdd).toHaveBeenCalledTimes(1)
      expect(spyRemove).toHaveBeenCalledTimes(1)
    })
    test('should invoke the callback on the offline event', () => {
      const callback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const spyAdd = vi.spyOn(engineCommandManager, 'addEventListener')
      const spyRemove = vi.spyOn(engineCommandManager, 'removeEventListener')

      const { unmount } = renderHook(() =>
        useOnOfflineToExitSketchMode({
          callback,
          engineCommandManager,
        })
      )
      engineCommandManager.dispatchEvent(
        new CustomEvent(EngineConnectionEvents.Offline, {})
      )
      unmount()
      expect(callback).toHaveBeenCalledTimes(1)
      expect(spyAdd).toHaveBeenCalledTimes(1)
      expect(spyRemove).toHaveBeenCalledTimes(1)
    })
    test('should invoke the callback on the offline event two times', () => {
      const callback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const spyAdd = vi.spyOn(engineCommandManager, 'addEventListener')
      const spyRemove = vi.spyOn(engineCommandManager, 'removeEventListener')

      const { unmount } = renderHook(() =>
        useOnOfflineToExitSketchMode({
          callback,
          engineCommandManager,
        })
      )
      engineCommandManager.dispatchEvent(
        new CustomEvent(EngineConnectionEvents.Offline, {})
      )
      engineCommandManager.dispatchEvent(
        new CustomEvent(EngineConnectionEvents.Offline, {})
      )
      unmount()
      expect(callback).toHaveBeenCalledTimes(2)
      expect(spyAdd).toHaveBeenCalledTimes(1)
      expect(spyRemove).toHaveBeenCalledTimes(1)
    })
  })
})
