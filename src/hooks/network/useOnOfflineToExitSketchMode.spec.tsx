import { renderHook } from '@testing-library/react'
import { useOnOfflineToExitSketchMode } from '@src/hooks/network/useOnOfflineToExitSketchMode'
import { expect, vi, describe, test } from 'vitest'
import { EngineConnectionEvents } from '@src/network/utils'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

describe('useOnOfflineToExitSketchMode', () => {
  describe('on mounted', () => {
    test('should do nothing', async () => {
      const callback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
      const { unmount } = renderHook(() =>
        useOnOfflineToExitSketchMode({
          callback,
          engineCommandManager,
        })
      )
      unmount()
      expect(callback).toHaveBeenCalledTimes(0)
    })
    test('should add and remove offline listener on engine command manager', async () => {
      const callback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
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
    test('should invoke the callback on the offline event', async () => {
      const callback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
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
    test('should invoke the callback on the offline event two times', async () => {
      const callback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
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
