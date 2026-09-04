import type { App, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron'

// Based on https://github.com/electron-userland/electron-builder/issues/8997#issuecomment-2846114257
export function prepareMacUpdateInstall(
  app: App,
  browserWindows: BrowserWindow[],
  saveWindowBounds: (browserWindow: BrowserWindow) => void
) {
  const beforeQuitListeners = app.listeners('before-quit')
  app.removeAllListeners('before-quit')
  for (const browserWindow of browserWindows) {
    try {
      // app.exit() bypasses window close events, so persist bounds first.
      saveWindowBounds(browserWindow)
    } catch (error) {
      console.error('Failed to save window bounds before update install', error)
    }
    // Close listeners that prevent default can make quitAndInstall() hang.
    browserWindow.removeAllListeners('close')
  }

  autoUpdater.once('before-quit-for-update', () => {
    // Do any before-quit cleanup here
    for (const listener of beforeQuitListeners) {
      try {
        listener.call(app, {
          preventDefault: () => {
            // `preventDefault` during update install causes quit+install to hang.
          },
        })
      } catch (error) {
        console.error(
          'Failed to run before-quit listener during update install',
          error
        )
      }
    }

    // Force app to exit
    app.exit()
  })
}
