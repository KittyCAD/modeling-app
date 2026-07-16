import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getModule: vi.fn(),
  init: vi.fn(),
  notifyActiveWasmInstance: vi.fn(),
  reloadModule: vi.fn(),
}))

vi.mock('@src/lib/wasm_lib_wrapper', () => ({
  getModule: mocks.getModule,
  init: mocks.init,
  reloadModule: mocks.reloadModule,
}))

vi.mock('@src/lib/wasmLifecycle', () => ({
  notifyActiveWasmInstance: mocks.notifyActiveWasmInstance,
}))

const wasmModule = {
  default: vi.fn(),
  import_file_extensions: vi.fn(),
} as unknown as ModuleType & {
  default: ReturnType<typeof vi.fn>
}

describe('wasm utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getModule.mockReturnValue(wasmModule)
    wasmModule.default.mockResolvedValue(undefined)
    globalThis.fetch = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    })
  })

  it('notifies listeners after browser wasm initialization', async () => {
    const { initialiseWasm } = await import('@src/lang/wasmUtils')

    await expect(initialiseWasm()).resolves.toBe(wasmModule)

    expect(mocks.reloadModule).toHaveBeenCalled()
    expect(mocks.init).toHaveBeenCalled()
    expect(mocks.notifyActiveWasmInstance).toHaveBeenCalledWith(wasmModule)
  })

  it('starts wasm from a buffer and notifies listeners', async () => {
    const { startWasmFromBuffer } = await import('@src/lang/wasmUtils')
    const buffer = new ArrayBuffer(8)

    await expect(startWasmFromBuffer(buffer)).resolves.toBe(wasmModule)

    expect(mocks.reloadModule).toHaveBeenCalled()
    expect(mocks.init).toHaveBeenCalledWith({ module_or_path: buffer })
    expect(mocks.notifyActiveWasmInstance).toHaveBeenCalledWith(wasmModule)
  })

  it('restarts wasm and notifies listeners', async () => {
    const { restartWasmModule } = await import('@src/lang/wasmUtils')

    await expect(restartWasmModule()).resolves.toBe(wasmModule)

    expect(mocks.reloadModule).toHaveBeenCalled()
    expect(wasmModule.default).toHaveBeenCalled()
    expect(mocks.notifyActiveWasmInstance).toHaveBeenCalledWith(wasmModule)
  })
})
