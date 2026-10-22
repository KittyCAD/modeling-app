import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
}

describe('wasm utils', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    mocks.getModule.mockReturnValue(wasmModule)
    wasmModule.default.mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new ArrayBuffer(8)))
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('loads the generated wasm package and notifies listeners', async () => {
    const { initialiseWasm } = await import('@src/lang/wasmUtils')

    await expect(initialiseWasm()).resolves.toBe(wasmModule)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/rust\/kcl-wasm-lib\/pkg\/kcl_wasm_lib_bg\.wasm$/)
    )
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

  it('waits for runtime flags before resolving module readiness', async () => {
    const notification = Promise.withResolvers<undefined>()
    mocks.notifyActiveWasmInstance.mockReturnValue(notification.promise)
    const { restartWasmModule } = await import('@src/lang/wasmUtils')
    const ready = vi.fn()
    const restart = restartWasmModule().then(ready)
    await vi.waitFor(() =>
      expect(mocks.notifyActiveWasmInstance).toHaveBeenCalled()
    )
    expect(ready).not.toHaveBeenCalled()
    notification.resolve(undefined)
    await restart
    expect(ready).toHaveBeenCalledWith(wasmModule)
  })

  it('does not publish an older restart whose provider finishes after a newer restart', async () => {
    const olderInit = Promise.withResolvers<undefined>()
    const older = { default: vi.fn().mockReturnValue(olderInit.promise) }
    mocks.getModule.mockReturnValueOnce(older).mockReturnValue(wasmModule)
    const { restartWasmModule } = await import('@src/lang/wasmUtils')
    const olderRestart = restartWasmModule()
    const rejectedOlder = expect(olderRestart).rejects.toMatchObject({
      name: 'AbortError',
    })
    await vi.waitFor(() => expect(older.default).toHaveBeenCalledOnce())
    await expect(restartWasmModule()).resolves.toBe(wasmModule)
    olderInit.resolve(undefined)
    await rejectedOlder
    expect(mocks.notifyActiveWasmInstance).toHaveBeenCalledExactlyOnceWith(
      wasmModule
    )
  })

  it('does not let an older initial fetch supersede a newer restart', async () => {
    const response = Promise.withResolvers<Response>()
    vi.mocked(fetch).mockReturnValue(response.promise)
    const { initialiseWasm, restartWasmModule } = await import(
      '@src/lang/wasmUtils'
    )
    const initial = initialiseWasm()
    const rejectedInitial = expect(initial).rejects.toMatchObject({
      name: 'AbortError',
    })
    await expect(restartWasmModule()).resolves.toBe(wasmModule)
    response.resolve(new Response(new ArrayBuffer(8)))
    await rejectedInitial
    expect(mocks.reloadModule).toHaveBeenCalledOnce()
    expect(mocks.init).not.toHaveBeenCalled()
    expect(mocks.notifyActiveWasmInstance).toHaveBeenCalledExactlyOnceWith(
      wasmModule
    )
  })

  it('does not publish a superseded buffered initialization', async () => {
    const init = Promise.withResolvers<undefined>()
    mocks.init.mockReturnValue(init.promise)
    const { startWasmFromBuffer, restartWasmModule } = await import(
      '@src/lang/wasmUtils'
    )
    const initial = startWasmFromBuffer(new ArrayBuffer(8))
    const rejectedInitial = expect(initial).rejects.toMatchObject({
      name: 'AbortError',
    })
    await vi.waitFor(() => expect(mocks.init).toHaveBeenCalledOnce())
    await expect(restartWasmModule()).resolves.toBe(wasmModule)
    init.resolve(undefined)
    await rejectedInitial
    expect(mocks.notifyActiveWasmInstance).toHaveBeenCalledExactlyOnceWith(
      wasmModule
    )
  })
})
