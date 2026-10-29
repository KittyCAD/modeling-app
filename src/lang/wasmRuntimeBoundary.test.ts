import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  Context: class {},
  default: vi.fn().mockResolvedValue({ context_new: vi.fn() }),
  initSync: vi.fn(),
  parse_wasm: vi.fn(),
  set_kcl_runtime_flags: vi.fn(),
  LspServerConfig: class {},
  lsp_run_kcl: vi.fn(),
  e2e_panic: vi.fn(),
}))
vi.mock('@rust/kcl-wasm-lib/pkg/kcl_wasm_lib', () => native)
vi.mock('fs/promises', () => ({
  default: { readFile: vi.fn().mockResolvedValue(new Uint8Array(8)) },
}))

describe('public Wasm initialization boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new ArrayBuffer(8)))
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['renderer', 'buffer', 'node', 'node-global'])(
    '%s returns utilities without native allocation or initialization capabilities',
    async (entry) => {
      const { initialiseWasm, startWasmFromBuffer } = await import(
        '@src/lang/wasmUtils'
      )
      const { initialiseWasmNode, loadAndInitialiseWasmInstance } =
        await import('@src/lang/wasmUtilsNode')
      const module = await (entry === 'renderer'
        ? initialiseWasm()
        : entry === 'buffer'
          ? startWasmFromBuffer(new ArrayBuffer(8))
          : entry === 'node-global'
            ? initialiseWasmNode()
            : loadAndInitialiseWasmInstance('/fixture.wasm'))
      for (const capability of [
        'Context',
        'default',
        'initSync',
        'context_new',
      ])
        expect(Reflect.has(module, capability), capability).toBe(false)
      for (const capability of [
        'parse_wasm',
        'set_kcl_runtime_flags',
        'LspServerConfig',
        'lsp_run_kcl',
        'e2e_panic',
      ])
        expect(Reflect.get(module, capability)).toBe(
          Reflect.get(native, capability)
        )
      if (entry !== 'node') {
        const { getModule } = await import('@src/lib/wasm_lib_wrapper')
        expect(getModule()).toBe(module)
      }
    }
  )
})
