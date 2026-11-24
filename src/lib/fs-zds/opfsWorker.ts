import { resolveOPFSHandle as walk } from '@src/lib/fs-zds/opfsHandle'

const OPFS_PATH_SEPARATOR = '/'

export type OPFSWorkerRequest =
  | {
      id: number
      type: 'write-file'
      targetPath: string
      data: Uint8Array<ArrayBuffer>
    }
  | {
      id: number
      type: 'read-file'
      targetPath: string
    }

export type OPFSWorkerResponse =
  | { id: number; ok: true; data?: Uint8Array<ArrayBuffer> }
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
      let offset = 0
      while (offset < data.byteLength) {
        const written = accessHandle.write(data.subarray(offset), {
          at: offset,
        })
        if (written === 0) return Promise.reject('OPFS_WRITE_INCOMPLETE')
        offset += written
      }
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

const readFile = async (
  targetPath: string
): Promise<Uint8Array<ArrayBuffer>> => {
  const handle = await walk(targetPath)
  if (!handle) return Promise.reject('ENOENT')
  if (!(handle instanceof FileSystemFileHandle)) return Promise.reject('EISDIR')
  const create = (
    handle as FileSystemFileHandle & {
      createSyncAccessHandle: () => Promise<{
        getSize: () => number
        read: (data: Uint8Array<ArrayBuffer>, options: { at: number }) => number
        close: () => void
      }>
    }
  ).createSyncAccessHandle
  if (typeof create !== 'function')
    return Promise.reject('OPFS_READ_UNSUPPORTED')
  const access = await create.call(handle)
  try {
    const data = new Uint8Array(access.getSize())
    let offset = 0
    while (offset < data.byteLength) {
      const count = access.read(data.subarray(offset), { at: offset })
      if (count === 0) return Promise.reject('OPFS_READ_INCOMPLETE')
      offset += count
    }
    return data
  } finally {
    access.close()
  }
}

self.onmessage = (event: MessageEvent<OPFSWorkerRequest>) => {
  const request = event.data
  const { id, targetPath } = request
  const result =
    request.type === 'write-file'
      ? writeFile(targetPath, request.data)
      : readFile(targetPath)

  void result
    .then((data) => {
      const response: OPFSWorkerResponse = data
        ? { id, ok: true, data }
        : { id, ok: true }
      postMessage(response)
    })
    .catch((error: unknown) => {
      const response: OPFSWorkerResponse = {
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
      postMessage(response)
    })
}
