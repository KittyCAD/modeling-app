import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  Context: class {},
  default: vi.fn(),
  initSync: vi.fn(),
  import_file_extensions: vi.fn(),
}))
const mocks = vi.hoisted(() => ({ notifyActiveWasmInstance: vi.fn() }))
vi.mock('@rust/kcl-wasm-lib/pkg/kcl_wasm_lib', () => native)
vi.mock('@src/lib/wasmLifecycle', () => ({
  notifyActiveWasmInstance: mocks.notifyActiveWasmInstance,
}))

describe('wasm utils', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    native.default.mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new ArrayBuffer(8)))
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('loads the generated wasm package and notifies listeners', async () => {
    const { initialiseWasm } = await import('@src/lang/wasmUtils')
    const module = await initialiseWasm()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/rust\/kcl-wasm-lib\/pkg\/kcl_wasm_lib_bg\.wasm$/)
    )
    expect(native.default).toHaveBeenCalledOnce()
    expect(mocks.notifyActiveWasmInstance).toHaveBeenCalledWith(module)
  })

  it('starts wasm from a buffer and notifies listeners', async () => {
    const { startWasmFromBuffer } = await import('@src/lang/wasmUtils')
    const buffer = new ArrayBuffer(8)
    const module = await startWasmFromBuffer(buffer)
    expect(native.default).toHaveBeenCalledWith({ module_or_path: buffer })
    expect(mocks.notifyActiveWasmInstance).toHaveBeenCalledWith(module)
  })

  it('restarts wasm and notifies listeners', async () => {
    const { restartWasmModule } = await import('@src/lib/wasmRuntime')
    const module = await restartWasmModule()
    expect(native.default).toHaveBeenCalledWith(undefined)
    expect(mocks.notifyActiveWasmInstance).toHaveBeenCalledWith(module)
  })

  it('waits for runtime flags before resolving module readiness', async () => {
    const notification = Promise.withResolvers<undefined>()
    mocks.notifyActiveWasmInstance.mockReturnValue(notification.promise)
    const { restartWasmModule } = await import('@src/lib/wasmRuntime')
    const ready = vi.fn()
    const restart = restartWasmModule().then((module) => {
      ready(module)
      return module
    })
    await vi.waitFor(() =>
      expect(mocks.notifyActiveWasmInstance).toHaveBeenCalled()
    )
    expect(ready).not.toHaveBeenCalled()
    notification.resolve(undefined)
    const module = await restart
    expect(ready).toHaveBeenCalledWith(module)
  })

  it('does not publish an older restart whose provider finishes after a newer restart', async () => {
    const olderInit = Promise.withResolvers<undefined>()
    native.default.mockReturnValueOnce(olderInit.promise)
    const { restartWasmModule } = await import('@src/lib/wasmRuntime')
    const olderRestart = restartWasmModule()
    const rejectedOlder = expect(olderRestart).rejects.toMatchObject({
      name: 'AbortError',
    })
    await vi.waitFor(() => expect(native.default).toHaveBeenCalledOnce())
    const module = await restartWasmModule()
    olderInit.resolve(undefined)
    await rejectedOlder
    expect(mocks.notifyActiveWasmInstance).toHaveBeenCalledExactlyOnceWith(
      module
    )
  })

  it('does not let an older initial fetch supersede a newer restart', async () => {
    const response = Promise.withResolvers<Response>()
    vi.mocked(fetch).mockReturnValue(response.promise)
    const { initialiseWasm } = await import('@src/lang/wasmUtils')
    const { restartWasmModule } = await import('@src/lib/wasmRuntime')
    const initial = initialiseWasm()
    const rejectedInitial = expect(initial).rejects.toMatchObject({
      name: 'AbortError',
    })
    const module = await restartWasmModule()
    response.resolve(new Response(new ArrayBuffer(8)))
    await rejectedInitial
    expect(native.default).toHaveBeenCalledOnce()
    expect(mocks.notifyActiveWasmInstance).toHaveBeenCalledExactlyOnceWith(
      module
    )
  })

  it('does not publish a superseded buffered initialization', async () => {
    const init = Promise.withResolvers<undefined>()
    native.default.mockReturnValueOnce(init.promise)
    const { startWasmFromBuffer } = await import('@src/lang/wasmUtils')
    const { restartWasmModule } = await import('@src/lib/wasmRuntime')
    const initial = startWasmFromBuffer(new ArrayBuffer(8))
    const rejectedInitial = expect(initial).rejects.toMatchObject({
      name: 'AbortError',
    })
    await vi.waitFor(() => expect(native.default).toHaveBeenCalledOnce())
    const module = await restartWasmModule()
    init.resolve(undefined)
    await rejectedInitial
    expect(mocks.notifyActiveWasmInstance).toHaveBeenCalledExactlyOnceWith(
      module
    )
  })
})
