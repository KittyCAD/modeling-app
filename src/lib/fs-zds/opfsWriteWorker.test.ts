import { createContext, runInContext } from 'node:vm'
import { build } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { expect, test, vi } from 'vitest'

class DirectoryHandle {
  constructor(private children: [string, DirectoryHandle][] = []) {}

  async *entries() {
    yield* this.children
  }
}

test('writes a project file in a browser worker without Node globals', async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    // A normal Node import would hide the browser path shim's process dependency.
    plugins: [
      nodePolyfills({
        include: ['path'],
        globals: { Buffer: false, global: false, process: false },
      }),
    ],
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: 'src/lib/fs-zds/opfsWriteWorker.ts',
        output: { format: 'iife' },
      },
    },
  })
  if (!('output' in result)) {
    throw new Error('Expected one worker bundle')
  }
  const bundle = result.output.find((item) => item.type === 'chunk')
  if (!bundle) {
    throw new Error('Missing worker bundle')
  }

  const data = new TextEncoder().encode('cube = 1\n')
  const write = vi.fn((bytes: Uint8Array) => bytes.byteLength)
  const close = vi.fn()
  const getFileHandle = vi.fn(async () => ({
    createSyncAccessHandle: async () => ({
      truncate: vi.fn(),
      write,
      flush: vi.fn(),
      close,
    }),
  }))
  const project = Object.assign(new DirectoryHandle(), { getFileHandle })
  const root = new DirectoryHandle([
    ['projects', new DirectoryHandle([['project', project]])],
  ])
  const response = Promise.withResolvers<unknown>()
  const worker = createContext({
    onmessage: undefined,
    postMessage: response.resolve,
    navigator: { storage: { getDirectory: async () => root } },
    FileSystemDirectoryHandle: DirectoryHandle,
    FileSystemFileHandle: class {},
    request: {
      id: 1,
      type: 'write-file',
      targetPath: '/projects/project/main.kcl',
      data,
    },
  })
  runInContext('self = globalThis', worker)
  runInContext(bundle.code, worker)
  runInContext('onmessage({ data: request })', worker)

  await expect(response.promise).resolves.toEqual({ id: 1, ok: true })
  expect(getFileHandle).toHaveBeenCalledWith('main.kcl', { create: true })
  expect(write).toHaveBeenCalledExactlyOnceWith(data, { at: 0 })
  expect(close).toHaveBeenCalledOnce()
})
