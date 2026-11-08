import { createContext, runInContext } from 'node:vm'
import { build } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import tsconfigPaths from 'vite-tsconfig-paths'
import { beforeAll, expect, test, vi } from 'vitest'
import fc from 'fast-check'
import type {
  OPFSWorkerRequest,
  OPFSWorkerResponse,
} from '@src/lib/fs-zds/opfsWorker'

class DirectoryHandle {
  constructor(private children: [string, DirectoryHandle][] = []) {}

  async getDirectoryHandle(name: string) {
    const child = this.children.find(([childName]) => childName === name)
    if (!child) throw new DOMException('Directory not found', 'NotFoundError')
    return child[1]
  }

  async getFileHandle(name: string) {
    if (this.children.some(([childName]) => childName === name)) {
      throw new DOMException('Not a file', 'TypeMismatchError')
    }
    throw new DOMException('File not found', 'NotFoundError')
  }
}

let workerCode: string
beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    // A normal Node import would hide the browser path shim's process dependency.
    plugins: [
      tsconfigPaths(),
      nodePolyfills({
        include: ['path'],
        globals: { Buffer: false, global: false, process: false },
      }),
    ],
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: 'src/lib/fs-zds/opfsWorker.ts',
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

  workerCode = bundle.code
})

test('writes a project file in a browser worker without Node globals', async () => {
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
    DOMException,
    request: {
      id: 1,
      type: 'write-file',
      targetPath: '/projects/project/main.kcl',
      data,
    },
  })
  runInContext('self = globalThis', worker)
  runInContext(workerCode, worker)
  runInContext('onmessage({ data: request })', worker)

  await expect(response.promise).resolves.toEqual({ id: 1, ok: true })
  expect(getFileHandle).toHaveBeenCalledWith('main.kcl', { create: true })
  expect(write).toHaveBeenCalledExactlyOnceWith(data, { at: 0 })
  expect(close).toHaveBeenCalledOnce()
})

test('preserves bytes across partial worker writes and reads', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uint8Array({ maxLength: 1024 }),
      fc.integer({ min: 1, max: 32 }),
      async (contents, chunk) => {
        let stored = new Uint8Array(contents.byteLength + 5).fill(17)
        const close = vi.fn()
        class FileHandle {
          async createSyncAccessHandle() {
            return {
              truncate: (size: number) => {
                stored = new Uint8Array(size)
              },
              getSize: () => stored.byteLength,
              write: (bytes: Uint8Array, { at }: { at: number }) => {
                const count = Math.min(chunk, bytes.byteLength)
                if (at + count > stored.byteLength) {
                  const next = new Uint8Array(at + count)
                  next.set(stored)
                  stored = next
                }
                stored.set(bytes.subarray(0, count), at)
                return count
              },
              read: (bytes: Uint8Array, { at }: { at: number }) => {
                const count = Math.min(chunk, bytes.byteLength)
                bytes.set(stored.subarray(at, at + count))
                return count
              },
              flush: () => {},
              close,
            }
          }
        }
        const file = new FileHandle()
        const project = Object.assign(new DirectoryHandle(), {
          getFileHandle: async () => file,
        })
        const root = new DirectoryHandle([
          ['projects', new DirectoryHandle([['project', project]])],
        ])
        let respond: (message: OPFSWorkerResponse) => void = () => {
          throw new Error('Unexpected worker response')
        }
        const worker = createContext({
          onmessage: undefined,
          postMessage: (message: OPFSWorkerResponse) => respond(message),
          navigator: { storage: { getDirectory: async () => root } },
          FileSystemDirectoryHandle: DirectoryHandle,
          FileSystemFileHandle: FileHandle,
          DOMException,
        })
        runInContext('self = globalThis', worker)
        runInContext(workerCode, worker)
        const send = (request: OPFSWorkerRequest) => {
          const response = Promise.withResolvers<OPFSWorkerResponse>()
          respond = response.resolve
          worker.request = request
          runInContext('onmessage({ data: request })', worker)
          return response.promise
        }
        const targetPath = '/projects/project/main.kcl'
        await expect(
          send({ id: 1, type: 'write-file', targetPath, data: contents })
        ).resolves.toEqual({ id: 1, ok: true })
        const response = await send({ id: 2, type: 'read-file', targetPath })
        if (!response.ok || !response.data)
          throw new Error('Expected worker bytes')
        expect(Array.from(response.data)).toEqual(Array.from(contents))
        expect(close).toHaveBeenCalledTimes(2)
      }
    ),
    { numRuns: 40 }
  )
})
