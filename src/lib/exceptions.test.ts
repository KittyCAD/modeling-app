import type { KclManager } from '@src/lang/KclManager'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  restartWasmModule: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: mocks.toastError,
  },
}))

vi.mock('@src/lib/settings/settingsUtils', () => ({
  jsAppSettings: vi.fn(() => ({})),
}))

vi.mock('@src/lang/wasmUtils', () => ({
  restartWasmModule: mocks.restartWasmModule,
}))

const wasmModule = {} as ModuleType

async function waitForAssertion(assertion: () => void) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      if (attempt === 19) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
}

describe('window exception handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.restartWasmModule.mockResolvedValue(wasmModule)
  })

  it('restarts wasm through wasm utils after a wasm crash', async () => {
    const clearSceneAndBustCache = vi.fn().mockResolvedValue(undefined)
    const kclManager = {
      executeAstCleanUp: vi.fn(),
      rustContext: {
        clearSceneAndBustCache,
        settingsActor: {},
      },
      wasmInstancePromise: Promise.resolve({} as ModuleType),
    } as unknown as KclManager
    const { initializeWindowExceptionHandler } = await import(
      '@src/lib/exceptions'
    )

    initializeWindowExceptionHandler(kclManager)
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'Uncaught RuntimeError: unreachable',
      })
    )

    await waitForAssertion(() => {
      expect(mocks.restartWasmModule).toHaveBeenCalled()
    })
    await expect(kclManager.wasmInstancePromise).resolves.toBe(wasmModule)
    expect(clearSceneAndBustCache).toHaveBeenCalled()
  })
})
