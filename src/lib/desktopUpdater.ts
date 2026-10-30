import { autoUpdater } from 'electron-updater'

let checkPromise: Promise<void> | undefined
let updatePending = false
let notifyPendingUpdate: (() => void) | undefined

export function configureUpdateChecks(notifyReady: () => void) {
  notifyPendingUpdate = notifyReady
}

// Share one check across background polling, the Help menu, and renderer IPC.
// Keep it even after downloadPromise resolves: on macOS another check recreates
// Squirrel and can delete the staged app while its old ready flag remains set.
export function checkForUpdates(): Promise<void> {
  if (checkPromise) return checkPromise
  if (updatePending) {
    notifyPendingUpdate?.()
    return Promise.resolve()
  }
  updatePending = true
  checkPromise = Promise.resolve()
    .then(() => autoUpdater.checkForUpdates())
    .then(async (result) => {
      await result?.downloadPromise
      if (!result?.isUpdateAvailable) updatePending = false
    })
    .catch((error: unknown) => {
      updatePending = false
      return Promise.reject(error)
    })
    .finally(() => {
      checkPromise = undefined
    })
  return checkPromise
}

export function resetUpdateCheck() {
  updatePending = false
}
