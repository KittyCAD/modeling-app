import { reportRejection } from '@src/lib/trap'

export function canRevealInFileExplorer() {
  return (
    typeof window !== 'undefined' &&
    typeof window.electron?.showInFolder === 'function'
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
