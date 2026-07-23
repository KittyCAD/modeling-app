import { isDesktop } from '@src/lib/isDesktop'
import { reportRejection } from '@src/lib/trap'

export function canRevealInFileExplorer() {
  return (
    isDesktop() &&
    typeof window !== 'undefined' &&
    typeof window.electron?.showInFolder === 'function'
  )
}

export function canOpenPathInFileExplorer() {
  return (
    isDesktop() &&
    typeof window !== 'undefined' &&
    typeof window.electron?.openPath === 'function'
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

export function openPathInFileExplorer(path: string) {
  const electron = typeof window === 'undefined' ? undefined : window.electron
  const openPath = electron?.openPath
  if (typeof openPath !== 'function') {
    return
  }

  try {
    void Promise.resolve(openPath(path)).then((errorMessage) => {
      if (typeof errorMessage === 'string' && errorMessage.length > 0) {
        reportRejection(new Error(errorMessage))
      }
    }, reportRejection)
  } catch (error) {
    reportRejection(error)
  }
}
