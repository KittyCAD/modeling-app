import { useOnPageMounted } from '@src/hooks/network/useOnPageMounted'
import { App } from '@src/lib/app'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { createTestWasmRegistryItem } from '@src/unitTestUtils'
import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

describe('useOnPageMounted', () => {
  const singletons = App.fromProvided({
    registryOverrides: [
      createTestWasmRegistryItem(
        Promise.resolve({
          set_kcl_runtime_flags: vi.fn(),
        } as unknown as ModuleType)
      ),
    ],
  }).singletons

  describe('on mounted', () => {
    test('should run once', () => {
      const callback = vi.fn(() => 1)
      const { unmount, result } = renderHook(() =>
        useOnPageMounted({
          callback,
        })
      )
      unmount()
      expect(callback).toHaveBeenCalledTimes(1)

      // clean up test!
      result.current.resetGlobalEngineCommandManager(
        singletons.kclManager.engineCommandManager
      )
    })
    test('should reset with helper function', async () => {
      const callback_1 = vi.fn(() => 1)
      const callback_2 = vi.fn(() => 2)
      const { unmount, result, rerender } = renderHook(
        ({ callback }) =>
          useOnPageMounted({
            callback,
          }),
        { initialProps: { callback: callback_1 } }
      )
      result.current.resetGlobalEngineCommandManager(
        singletons.kclManager.engineCommandManager
      )
      rerender({ callback: callback_2 })
      unmount()
      expect(callback_1).toHaveBeenCalledTimes(1)
      expect(callback_2).toHaveBeenCalledTimes(1)
      // clean up test!
      result.current.resetGlobalEngineCommandManager(
        singletons.kclManager.engineCommandManager
      )
    })
    test('should fail to call the callback again, did not reset', async () => {
      const callback_1 = vi.fn(() => 1)
      const callback_2 = vi.fn(() => 2)
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
      result.current.resetGlobalEngineCommandManager(
        singletons.kclManager.engineCommandManager
      )
    })
  })
})
