import { DesktopUpdateController } from '@src/lib/desktopUpdateController'
import { autoUpdater as nativeUpdater } from 'electron'
import { autoUpdater } from 'electron-updater'

let desktopUpdater: DesktopUpdateController | undefined

// Shared by background checks, the native Help menu, and renderer IPC.
// Importing menu definitions should not initialize the Electron runtime.
export function getDesktopUpdater() {
  desktopUpdater ??= new DesktopUpdateController(
    autoUpdater,
    process.platform === 'darwin' ? nativeUpdater : undefined
  )
  return desktopUpdater
}
