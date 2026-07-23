import { useOnPageMounted } from '@src/hooks/network/useOnPageMounted'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

function createEngineCommandManager() {
  return { started: true } as ConnectionManager
}

describe('useOnPageMounted', () => {
  describe('on mounted', () => {
    test('should run once', () => {
      const callback = vi.fn(() => 1)
      const engineCommandManager = createEngineCommandManager()
      const { unmount, result } = renderHook(() =>
        useOnPageMounted({
          callback,
        })
      )
      unmount()
      expect(callback).toHaveBeenCalledTimes(1)

      // clean up test!
      result.current.resetGlobalEngineConnectionManager(engineCommandManager)
    })
    test('should reset with helper function', async () => {
      const callback_1 = vi.fn(() => 1)
      const callback_2 = vi.fn(() => 2)
      const engineCommandManager = createEngineCommandManager()
      const { unmount, result, rerender } = renderHook(
        ({ callback }) =>
          useOnPageMounted({
            callback,
          }),
        { initialProps: { callback: callback_1 } }
      )
      result.current.resetGlobalEngineConnectionManager(engineCommandManager)
      rerender({ callback: callback_2 })
      unmount()
      expect(callback_1).toHaveBeenCalledTimes(1)
      expect(callback_2).toHaveBeenCalledTimes(1)
      // clean up test!
      result.current.resetGlobalEngineConnectionManager(engineCommandManager)
    })
    test('should fail to call the callback again, did not reset', async () => {
      const callback_1 = vi.fn(() => 1)
      const callback_2 = vi.fn(() => 2)
      const engineCommandManager = createEngineCommandManager()
      const { unmount, result, rerender } = renderHook(
        ({ callback }) =>
          useOnPageMounted({
            callback,
          }),
        { initialProps: { callback: callback_1 } }
      )
      rerender({ callback: callback_2 })
      unmount()
      expect(callback_1).toHaveBeenCalledTimes(1)
      expect(callback_2).toHaveBeenCalledTimes(0)
      // clean up test!
      result.current.resetGlobalEngineConnectionManager(engineCommandManager)
    })
  })
})
