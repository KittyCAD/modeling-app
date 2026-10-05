import type { KclRuntimeFlags } from '@rust/kcl-lib/bindings/KclRuntimeFlags'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalOnmessage = globalThis.onmessage

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  run: vi.fn(async () => {
    mocks.order.push('lsp-run')
  }),
  setFlags: vi.fn(() => {
    mocks.order.push('set-flags')
  }),
  wasmInit: vi.fn(async () => {
    mocks.order.push('wasm-init')
    return {}
  }),
}))

vi.mock('@kittycad/codemirror-lsp-client', () => {
  const emptyAsyncIterable = {
    async *[Symbol.asyncIterator]() {},
  }
  return {
    Codec: {
      decode: vi.fn(),
      encode: vi.fn(),
    },
    FromServer: {
      create: vi.fn(() => ({
        notifications: emptyAsyncIterable,
        requests: emptyAsyncIterable,
        responses: new Map(),
      })),
    },
    IntoServer: class {
      enqueue = vi.fn()
    },
    LspWorkerEventType: {
      Call: 'call',
      Init: 'init',
    },
  }
})

vi.mock('@rust/kcl-wasm-lib/pkg/kcl_wasm_lib', () => ({
  default: mocks.wasmInit,
  LspServerConfig: class {},
  lsp_run_kcl: mocks.run,
  set_kcl_runtime_flags: mocks.setFlags,
}))

vi.mock('@src/lang/std/fileSystemManager', () => ({
  projectFsManager: {},
}))

describe('KCL LSP worker initialization', () => {
  afterEach(() => {
    globalThis.onmessage = originalOnmessage
    vi.unstubAllGlobals()
  })

  it.each(['On', 'Off'] as const)(
    'installs %s runtime flags before starting the LSP',
    async (useNewLexerParser) => {
      // Reload the worker so each case installs its own message handler.
      vi.resetModules()
      mocks.order.length = 0
      vi.clearAllMocks()
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          arrayBuffer: async () => new ArrayBuffer(0),
        }))
      )
      await import('@src/lang/lsp/worker')
      const workerGlobal = globalThis as typeof globalThis & {
        onmessage: (event: MessageEvent) => void
      }
      const kclRuntimeFlags: KclRuntimeFlags = {
        use_new_lexer_parser: useNewLexerParser,
      }

      workerGlobal.onmessage(
        new MessageEvent('message', {
          data: {
            worker: 'kcl',
            eventType: 'init',
            eventData: {
              wasmUrl: '/kcl.wasm',
              token: 'token',
              apiBaseUrl: 'https://api.example.com',
              kclRuntimeFlags,
            },
          },
        })
      )

      await vi.waitFor(() => {
        expect(mocks.run).toHaveBeenCalledTimes(1)
      })
      expect(mocks.order).toEqual(['wasm-init', 'set-flags', 'lsp-run'])
      expect(mocks.setFlags).toHaveBeenCalledWith(
        JSON.stringify(kclRuntimeFlags)
      )
    }
  )
})
