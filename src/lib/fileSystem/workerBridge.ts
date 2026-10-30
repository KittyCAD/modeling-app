import { isArray } from '@src/lib/utils'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

export type FileReadOperations = Pick<
  FileOperationsRegistryService,
  'readFile' | 'exists' | 'readDirectory'
>
type Request = { id: number; method: keyof FileReadOperations; path: string }
type Response = { id: number; value?: unknown; error?: string }

/** The worker asks the owning application for bytes; it owns no second filesystem. */
export function serveFileReads(
  port: MessagePort,
  operations: FileReadOperations
) {
  let disposed = false
  port.onmessage = (event: MessageEvent<Request>) => {
    const { id, method, path } = event.data
    const respond = (response: Response) => {
      if (!disposed) port.postMessage(response)
    }
    const execute = async () => {
      switch (method) {
        case 'readFile':
          return operations.readFile(path)
        case 'exists':
          return operations.exists(path)
        case 'readDirectory':
          return operations.readDirectory(path)
      }
      return Promise.reject(new Error('Unknown filesystem request.'))
    }
    void execute().then(
      (value) => respond({ id, value }),
      (error: unknown) =>
        respond({
          id,
          error:
            error instanceof Error
              ? error.message
              : 'Filesystem request failed.',
        })
    )
  }
  port.start()
  return () => {
    disposed = true
    port.close()
  }
}

export function createFileReadClient(port: MessagePort): FileReadOperations {
  let nextId = 0
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  port.onmessage = (event: MessageEvent<Response>) => {
    const { id, value, error } = event.data
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    if (error) request.reject(new Error(error))
    else request.resolve(value)
  }
  port.start()
  const call = (method: Request['method'], path: string) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      port.postMessage({ id, method, path } satisfies Request)
    })
  return {
    readFile: async (path) => {
      const result = await call('readFile', path)
      return result instanceof Uint8Array
        ? result
        : Promise.reject(new Error('Invalid file response.'))
    },
    exists: async (path) => {
      const result = await call('exists', path)
      return typeof result === 'boolean'
        ? result
        : Promise.reject(new Error('Invalid existence response.'))
    },
    readDirectory: async (path) => {
      const result = await call('readDirectory', path)
      return isArray(result) &&
        result.every((name): name is string => typeof name === 'string')
        ? result
        : Promise.reject(new Error('Invalid directory response.'))
    },
  }
}
