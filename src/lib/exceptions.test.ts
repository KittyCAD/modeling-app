import * as wasmModule from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  restartWasmModule: vi.fn<() => Promise<ModuleType>>(),
  toastError: vi.fn(),
}))

// Recovery passes module identity through, but does not invoke Wasm.
vi.mock('@rust/kcl-wasm-lib/pkg/kcl_wasm_lib', () => ({}))
vi.mock('react-hot-toast', () => ({ default: { error: mocks.toastError } }))
vi.mock('@src/lib/settings/settingsUtils', () => ({
  jsAppSettings: vi.fn(() => ({})),
}))
vi.mock('@src/lang/wasmUtils', () => ({
  restartWasmModule: mocks.restartWasmModule,
}))

const errorListeners: EventListenerOrEventListenerObject[] = []

function recoveryTarget() {
  const finishFailedExecutions = vi.fn()
  return {
    engineCommandManager: {
      captureFailedExecutionCleanup: vi.fn(() => finishFailedExecutions),
    },
    executeAstCleanUp: vi.fn(),
    rustContext: {
      replaceWasmInstance: vi
        .fn<(module: Promise<ModuleType>) => Promise<void>>()
        .mockResolvedValue(undefined),
      clearSceneAndBustCache: vi.fn().mockResolvedValue(undefined),
    },
    wasmInstancePromise: Promise.resolve(wasmModule),
    finishFailedExecutions,
  }
}

function crash() {
  window.dispatchEvent(
    new ErrorEvent('error', { message: 'Uncaught RuntimeError: unreachable' })
  )
}

describe('window exception handler', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.restartWasmModule.mockReset().mockResolvedValue(wasmModule)
    const addEventListener = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        if (type === 'error') errorListeners.push(listener)
        addEventListener(type, listener, options)
      }
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const listener of errorListeners.splice(0))
      window.removeEventListener('error', listener)
    vi.restoreAllMocks()
  })

  it('replaces the crashed context before finishing its scoped execution cleanup', async () => {
    const replay = Promise.withResolvers<undefined>()
    const target = recoveryTarget()
    target.rustContext.replaceWasmInstance.mockReturnValue(replay.promise)
    const { initializeWindowExceptionHandler } = await import(
      '@src/lib/exceptions'
    )
    initializeWindowExceptionHandler(target)
    crash()

    await vi.waitFor(() =>
      expect(target.rustContext.replaceWasmInstance).toHaveBeenCalledOnce()
    )
    expect(target.rustContext.replaceWasmInstance).toHaveBeenCalledWith(
      target.wasmInstancePromise
    )
    expect(
      target.engineCommandManager.captureFailedExecutionCleanup
    ).toHaveBeenCalledOnce()
    expect(target.executeAstCleanUp).toHaveBeenCalledOnce()
    expect(target.rustContext.clearSceneAndBustCache).not.toHaveBeenCalled()
    expect(target.finishFailedExecutions).not.toHaveBeenCalled()
    replay.resolve(undefined)
    await vi.waitFor(() =>
      expect(target.finishFailedExecutions).toHaveBeenCalledOnce()
    )
  })

  it('releases abandoned executions even when replacement fails', async () => {
    const target = recoveryTarget()
    target.rustContext.replaceWasmInstance.mockRejectedValue(
      new Error('Wasm replacement failed')
    )
    const { initializeWindowExceptionHandler } = await import(
      '@src/lib/exceptions'
    )
    initializeWindowExceptionHandler(target)
    crash()
    await vi.waitFor(() =>
      expect(target.finishFailedExecutions).toHaveBeenCalledOnce()
    )
    expect(target.rustContext.clearSceneAndBustCache).not.toHaveBeenCalled()
  })

  it('keeps each recovery cleanup scoped while a newer restart finishes first', async () => {
    const oldModule = Promise.withResolvers<ModuleType>()
    const nextModule = Promise.withResolvers<ModuleType>()
    mocks.restartWasmModule
      .mockReturnValueOnce(oldModule.promise)
      .mockReturnValueOnce(nextModule.promise)
    const target = recoveryTarget()
    const finishOld = vi.fn()
    const finishNext = vi.fn()
    target.engineCommandManager.captureFailedExecutionCleanup
      .mockReturnValueOnce(finishOld)
      .mockReturnValueOnce(finishNext)
    target.rustContext.replaceWasmInstance.mockImplementation(
      async (module) => {
        await module
      }
    )
    const { initializeWindowExceptionHandler } = await import(
      '@src/lib/exceptions'
    )
    initializeWindowExceptionHandler(target)
    crash()
    crash()
    nextModule.resolve(wasmModule)
    await vi.waitFor(() => expect(finishNext).toHaveBeenCalledOnce())
    expect(finishOld).not.toHaveBeenCalled()
    expect(target.wasmInstancePromise).toBe(nextModule.promise)
    oldModule.resolve({ ...wasmModule })
    await vi.waitFor(() => expect(finishOld).toHaveBeenCalledOnce())
    expect(target.wasmInstancePromise).toBe(nextModule.promise)
  })

  it('does not restart Wasm for unrelated browser errors', async () => {
    const target = recoveryTarget()
    const { initializeWindowExceptionHandler } = await import(
      '@src/lib/exceptions'
    )
    initializeWindowExceptionHandler(target)
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'Unrelated error' })
    )
    expect(mocks.restartWasmModule).not.toHaveBeenCalled()
    expect(
      target.engineCommandManager.captureFailedExecutionCleanup
    ).not.toHaveBeenCalled()
  })
})
