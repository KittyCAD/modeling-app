import { MessageChannel } from 'node:worker_threads'
import {
  createFileReadClient,
  serveFileReads,
} from '@src/lib/fileSystem/workerBridge'
import { describe, expect, it } from 'vitest'

describe('worker filesystem bridge', () => {
  it('reads current owned bytes and propagates failures from the application', async () => {
    const channel = new MessageChannel()
    // Node's ports implement the browser messaging API used by the worker.
    const main = channel.port1 as unknown as MessagePort
    const worker = channel.port2 as unknown as MessagePort
    let bytes = new Uint8Array([1])
    const stop = serveFileReads(main, {
      readFile: async (path) =>
        path === '/missing' ? Promise.reject(new Error('Missing file')) : bytes,
      exists: async (path) => path !== '/missing',
      readDirectory: async () => ['main.kcl', 'parts'],
    })
    const client = createFileReadClient(worker)
    try {
      expect(await client.readFile('/main.kcl')).toEqual(new Uint8Array([1]))
      bytes = new Uint8Array([2])
      expect(await client.readFile('/main.kcl')).toEqual(new Uint8Array([2]))
      expect(await client.exists('/missing')).toBe(false)
      expect(await client.readDirectory('/')).toEqual(['main.kcl', 'parts'])
      await expect(client.readFile('/missing')).rejects.toThrow('Missing file')
    } finally {
      stop()
      worker.close()
    }
  })
})
