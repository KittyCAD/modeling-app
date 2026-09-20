import { reportRejection } from '@src/lib/trap'
import { refreshPage } from '@src/lib/utils'

const RECOVERY_KEY = 'zoo-preload-recovery-revision'

export function initializePreloadRecovery(kclManager: {
  flushWriteToFile: () => Promise<boolean>
}) {
  window.addEventListener('vite:preloadError', (event) => {
    const revision = import.meta.env.MODELING_APP_COMMIT_SHA ?? 'development'
    if (window.sessionStorage.getItem(RECOVERY_KEY) === revision) {
      return
    }

    window.sessionStorage.setItem(RECOVERY_KEY, revision)
    event.preventDefault()

    kclManager
      .flushWriteToFile()
      .then((saved) => {
        if (!saved) {
          window.sessionStorage.removeItem(RECOVERY_KEY)
          return
        }
        return refreshPage('Stale app version')
      })
      .catch((error) => {
        window.sessionStorage.removeItem(RECOVERY_KEY)
        reportRejection(error)
      })
  })
}
