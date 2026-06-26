import { reportRejection } from '@src/lib/trap'

export function canRevealInFileExplorer() {
  return (
    typeof window !== 'undefined' &&
    typeof window.electron?.showInFolder === 'function'
  )
}

export function revealInFileExplorer(path: string) {
  const electron = typeof window === 'undefined' ? undefined : window.electron
  if (!electron) {
    return
  }

  void Promise.resolve(electron.showInFolder(path)).catch(reportRejection)
}
