import path from 'path'

type WriteFileRequest = {
  id: number
  type: 'write-file'
  targetPath: string
  data: Uint8Array<ArrayBuffer>
}

type WorkerResponse =
  | { id: number; ok: true }
  | { id: number; ok: false; error: string }

const walk = async (
  targetPath: string
): Promise<undefined | FileSystemDirectoryHandle | FileSystemFileHandle> => {
  let current = await navigator.storage.getDirectory()
  let cwd = ''
  let looped = true
  let currentChanged = true

  if (targetPath.split(path.sep).length === 2) {
    return current
  }

  while (looped && currentChanged) {
    let entries = current.entries()
    looped = false
    currentChanged = false
    for await (let [name, handle] of entries) {
      looped = true
      const currentPath = path.resolve(cwd, name)

      if (targetPath.startsWith(currentPath) === false) {
        continue
      }

      if (targetPath === currentPath) {
        return handle
      }

      if (handle instanceof FileSystemDirectoryHandle) {
        cwd = currentPath
        current = handle
        currentChanged = true
        break
      }

      return undefined
    }
  }

  return undefined
}

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
        write: (data: Blob) => Promise<void>
        close: () => Promise<void>
      }>
    }
  ).createWritable

  if (typeof writableMethod === 'function') {
    const writer = await writableMethod.call(handle)
    await writer.write(new Blob([data], { type: 'application/octet-stream' }))
    await writer.close()
    return
  }

  throw new Error('OPFS_WRITE_UNSUPPORTED')
}

const writeFile = async (
  targetPath: string,
  data: Uint8Array<ArrayBuffer>
): Promise<void> => {
  const parts = targetPath.split(path.sep)
  const parent = parts.slice(0, -1).join(path.sep)
  const handle = await walk(parent)
  if (handle === undefined) throw new Error('ENOENT')
  if (handle instanceof FileSystemFileHandle) throw new Error('EISFILE')

  const fileHandle = await handle.getFileHandle(parts.slice(-1)[0], {
    create: true,
  })

  await writeWithHandle(fileHandle, data)
}

onmessage = (event: MessageEvent<WriteFileRequest>) => {
  const { id, type, targetPath, data } = event.data
  if (type !== 'write-file') return

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
