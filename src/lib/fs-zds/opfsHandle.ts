import path from 'path'
import { webSafePathSplit } from '@src/lib/pathUtils'

export async function resolveOPFSHandle(
  targetPath: string
): Promise<FileSystemDirectoryHandle | FileSystemFileHandle | undefined> {
  // OPFS paths are rooted at '/', including in workers without process.cwd().
  const parts = webSafePathSplit(path.posix.resolve('/', targetPath)).filter(
    (part) => part !== ''
  )
  let directory = await navigator.storage.getDirectory()
  const name = parts.pop()
  if (name === undefined) return directory

  for (const part of parts) {
    try {
      directory = await directory.getDirectoryHandle(part)
    } catch (error: unknown) {
      if (
        error instanceof DOMException &&
        (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')
      ) {
        return undefined
      }
      return Promise.reject(error)
    }
  }

  try {
    return await directory.getFileHandle(name)
  } catch (error: unknown) {
    if (!(error instanceof DOMException)) return Promise.reject(error)
    if (error.name === 'NotFoundError') return undefined
    if (error.name !== 'TypeMismatchError') return Promise.reject(error)
  }

  try {
    return await directory.getDirectoryHandle(name)
  } catch (error: unknown) {
    if (
      error instanceof DOMException &&
      (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')
    ) {
      return undefined
    }
    return Promise.reject(error)
  }
}
