import type { FileOperationsMount } from '@src/lib/fileSystem/mounts'
import { getContainedRelativePath } from '@src/lib/fileSystem/pathContainment'
import fsZds from '@src/lib/fs-zds'
import { isDesktop } from '@src/lib/isDesktop'
import { reportRejection } from '@src/lib/trap'

export function canRevealInFileExplorer() {
  return (
    isDesktop() &&
    typeof window !== 'undefined' &&
    typeof window.electron?.showInFolder === 'function'
  )
}

export function canRevealPathInFileExplorer(
  path: string | undefined,
  mounts: readonly FileOperationsMount[]
) {
  if (!path || !canRevealInFileExplorer()) return false

  const paths = { relative: fsZds.relative, sep: fsZds.sep }
  return !mounts.some(
    ({ root }) => getContainedRelativePath(paths, root, path) !== undefined
  )
}

export function revealInFileExplorer(path: string) {
  const electron = typeof window === 'undefined' ? undefined : window.electron
  const showInFolder = electron?.showInFolder
  if (typeof showInFolder !== 'function') {
    return
  }

  try {
    void Promise.resolve(showInFolder(path)).catch(reportRejection)
  } catch (error) {
    reportRejection(error)
  }
}
