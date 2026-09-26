import { resolveOPFSHandle as walk } from '@src/lib/fs-zds/opfsHandle'

const OPFS_PATH_SEPARATOR = '/'

type WriteFileRequest = {
  id: number
  type: 'write-file'
  targetPath: string
  data: Uint8Array<ArrayBuffer>
}

type WorkerResponse =
  | { id: number; ok: true }
  | { id: number; ok: false; error: string }

const writeWithHandle = async (
  handle: FileSystemFileHandle,
  data: Uint8Array<ArrayBuffer>
) => {
  const syncHandleMethod = (
    handle as FileSystemFileHandle & {
      createSyncAccessHandle?: () => Promise<{
        truncate: (size: number) => void
        write: (
          data: Uint8Array<ArrayBuffer>,
          options?: { at?: number }
        ) => number
        flush: () => void
        close: () => void
      }>
    }
  ).createSyncAccessHandle

  if (typeof syncHandleMethod === 'function') {
    const accessHandle = await syncHandleMethod.call(handle)
    try {
      accessHandle.truncate(0)
      accessHandle.write(data, { at: 0 })
      accessHandle.flush()
    } finally {
      accessHandle.close()
    }
    return
  }

  const writableMethod = (
    handle as FileSystemFileHandle & {
      createWritable?: () => Promise<{
        write: (data: Uint8Array<ArrayBuffer>) => Promise<void>
        close: () => Promise<void>
      }>
    }
  ).createWritable

  if (typeof writableMethod === 'function') {
    const writer = await writableMethod.call(handle)
    await writer.write(data)
    await writer.close()
    return
  }

  return Promise.reject('OPFS_WRITE_UNSUPPORTED')
}

const writeFile = async (
  targetPath: string,
  data: Uint8Array<ArrayBuffer>
): Promise<void> => {
  const parts = targetPath.split(OPFS_PATH_SEPARATOR)
  const parent = parts.slice(0, -1).join(OPFS_PATH_SEPARATOR)
  const handle = await walk(parent)
  if (handle === undefined) {
    return Promise.reject('ENOENT')
  }
  if (handle instanceof FileSystemFileHandle) {
    return Promise.reject('EISFILE')
  }

  const fileHandle = await handle.getFileHandle(parts.slice(-1)[0], {
    create: true,
  })

  await writeWithHandle(fileHandle, data)
}

self.onmessage = (event: MessageEvent<WriteFileRequest>) => {
  const { id, type, targetPath, data } = event.data
  if (type !== 'write-file') {
    return
  }

  void writeFile(targetPath, data)
    .then(() => {
      const response: WorkerResponse = { id, ok: true }
      postMessage(response)
    })
    .catch((error: unknown) => {
      const response: WorkerResponse = {
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
      postMessage(response)
    })
}
