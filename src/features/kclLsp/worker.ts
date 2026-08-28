/// <reference lib="webworker" />

import {
  LspServerConfig,
  lsp_run_kcl,
} from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
import {
  createMessageDeframer,
  encodeMessage,
} from '@src/features/kclLsp/framing'
import type {
  FromWorker,
  FsMethod,
  ToWorker,
} from '@src/features/kclLsp/workerProtocol'
import { loadKclWasm } from '@src/features/kclAnalysis/wasmModule'
import {
  basename,
  dirname,
  extname,
  joinPath,
  relativePath,
} from '@src/lib/paths'

/**
 * The KCL language server, hosted.
 *
 * A worker because the server is WASM and it runs a real parser: on the main
 * thread, a completion request on a large file would compete with the frame that
 * is drawing the cursor. The renderer never sees any of this — it holds a
 * `Transport` and posts JSON.
 *
 * `LspServerConfig` takes plain web primitives — `(into_server: AsyncIterator,
 * from_server: WritableStream, fs)` — so nothing here needs a vendored client.
 * What it does need is the protocol's framing, which is `framing.ts`, and a
 * filesystem, which is the renderer's and arrives by message.
 */

const post = (message: FromWorker) => {
  self.postMessage(message)
}

/**
 * Messages waiting for the server to read them.
 *
 * An async iterator with a queue behind it, because that is the shape Rust asks
 * for: it pulls, and a pull before anything has arrived has to wait rather than
 * end the stream.
 */
function createMessageQueue() {
  const waiting: Uint8Array[] = []
  let wake: (() => void) | null = null

  const iterator: AsyncIterator<Uint8Array> = {
    async next() {
      for (;;) {
        const value = waiting.shift()
        if (value) return { value, done: false }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
  }

  return {
    iterator,
    push(bytes: Uint8Array) {
      waiting.push(bytes)
      const resume = wake
      wake = null
      resume?.()
    },
  }
}

/**
 * The renderer's filesystem, as the server expects to find it.
 *
 * The path helpers are synchronous and pure, so they are answered here. Reads
 * are not: they cross back to the renderer, which owns the only filesystem there
 * is — the desktop's real one behind granted roots, or the browser's
 * origin-private one.
 *
 * Shaped to match what the WASM standard library calls, which is a subset of
 * Node's `fs` plus a `path` object.
 */
function createFilesystemBridge(projectPath: string) {
  let nextId = 0
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()

  const ask = (method: FsMethod, path: string) =>
    new Promise<unknown>((resolve, reject) => {
      const id = (nextId += 1)
      pending.set(id, { resolve, reject })
      post({ kind: 'fsRequest', id, method, path })
    })

  const settle = (message: ToWorker) => {
    if (message.kind === 'fsResult') {
      const entry = pending.get(message.id)
      pending.delete(message.id)
      entry?.resolve(message.value)
      return true
    }
    if (message.kind === 'fsError') {
      const entry = pending.get(message.id)
      pending.delete(message.id)
      entry?.reject(new Error(message.error))
      return true
    }
    return false
  }

  const fs = {
    dir: projectPath,

    path: {
      resolve: (...parts: string[]) => joinPath(...parts),
      join: (...parts: string[]) => joinPath(...parts),
      relative: (from: string, to: string) => relativePath(from, to) ?? to,
      extname,
      basename,
      dirname,
      sep: '/',
    },

    join: (dir: string, target: string) =>
      joinPath(dir, target.startsWith(dir) ? target.slice(dir.length) : target),

    /**
     * Text when an encoding is asked for, bytes otherwise.
     *
     * The standard library reads a KCL import as text and an asset as bytes
     * through the same call, so which one is wanted is only knowable from the
     * options.
     */
    readFile: async (target: string, options?: unknown) => {
      const encoding =
        typeof options === 'string'
          ? options
          : ((options as { encoding?: string } | null)?.encoding ?? null)

      return encoding
        ? ((await ask('readTextFile', target)) as string)
        : new Uint8Array((await ask('readFile', target)) as ArrayBufferLike)
    },

    exists: async (target: string) => (await ask('exists', target)) as boolean,

    getAllFiles: async (target: string) =>
      (await ask('getAllFiles', target)) as string[],
  }

  return { fs, settle }
}

let queue: ReturnType<typeof createMessageQueue> | null = null
let bridge: ReturnType<typeof createFilesystemBridge> | null = null

async function start(message: Extract<ToWorker, { kind: 'start' }>) {
  queue = createMessageQueue()
  bridge = createFilesystemBridge(message.projectPath)

  const deframe = createMessageDeframer((json) => {
    post({ kind: 'message', json })
  })

  const fromServer = new WritableStream<Uint8Array>({
    write(chunk) {
      deframe(chunk)
    },
  })

  // The same lazy loader the analysis executor uses, so a build has one copy of
  // the module and one story about where its binary comes from.
  await loadKclWasm()

  post({ kind: 'ready' })

  const config = new LspServerConfig(queue.iterator, fromServer, bridge.fs)

  /*
   * Runs until the server stops, which is until this worker is terminated.
   *
   * Not restartable in place: `lsp_run_kcl` consumes its config, so a new server
   * means a new worker. The renderer owns that decision, which is why it is the
   * one holding the `Worker` handle.
   */
  await lsp_run_kcl(config, message.token, message.apiBaseUrl)
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data

  if (bridge?.settle(message)) return

  switch (message.kind) {
    case 'start':
      start(message).catch((error: unknown) => {
        post({
          kind: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      })
      return

    case 'message':
      queue?.push(encodeMessage(message.json))
      return

    default:
      // A filesystem answer for a request nobody is waiting on. Dropping it is
      // correct: the only way here is a reply that arrived after a restart.
      return
  }
}
