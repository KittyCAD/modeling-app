import { renderHook } from '@testing-library/react'
import { useOnPageMounted } from '@src/hooks/network/useOnPageMounted'
import { expect, vi, describe, test } from 'vitest'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { App } from '@src/lib/app'

describe('useOnPageMounted', async () => {
  const app = App.fromProvided({
    wasmPromise: Promise.resolve({} as ModuleType),
  })
  const project = await app.openProject({
    path: 'some-project',
    name: 'i-should-really-change-this-api',
    children: [],
    default_file: 'main.kcl',
    directory_count: 0,
    kcl_file_count: 1,
    metadata: null,
    readWriteAccess: true,
  })
  const editor = await project.openEditor('some-path')

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

      const ecm = editor.engineCommandManager

      if (!ecm) {
        return
      }

      // clean up test!
      result.current.resetGlobalEngineCommandManager(ecm)
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
      const ecm = editor.engineCommandManager

      if (!ecm) {
        expect(
          new Error(`You don't event have an engineCommandManager, you fail.`)
        )
        return
      }

      result.current.resetGlobalEngineCommandManager(ecm)
      rerender({ callback: callback_2 })
      unmount()
      expect(callback_1).toHaveBeenCalledTimes(1)
      expect(callback_2).toHaveBeenCalledTimes(1)
      // clean up test!
      result.current.resetGlobalEngineCommandManager(ecm)
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
      const ecm = editor.engineCommandManager

      if (!ecm) {
        expect(
          new Error(`You don't event have an engineCommandManager, you fail.`)
        )
        return
      }
      // clean up test!
      result.current.resetGlobalEngineCommandManager(ecm)
    })
  })
})
