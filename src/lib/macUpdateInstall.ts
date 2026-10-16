import type { App, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron'

function isEventListener(
  listener: unknown
): listener is (...args: unknown[]) => void {
  return typeof listener === 'function'
}

// Based on https://github.com/electron-userland/electron-builder/issues/8997#issuecomment-2846114257
export function prepareMacUpdateInstall(
  app: App,
  browserWindows: BrowserWindow[],
  saveWindowBounds: (browserWindow: BrowserWindow) => void
): () => void {
  // Keep once wrappers so a failed install can restore their original behavior.
  const beforeQuitListeners = app
    .rawListeners('before-quit')
    .filter(isEventListener)
  const windowCloseListeners = browserWindows
    .filter((browserWindow) => !browserWindow.isDestroyed())
    .map((browserWindow) => ({
      browserWindow,
      listeners: browserWindow.rawListeners('close').filter(isEventListener),
    }))
  app.removeAllListeners('before-quit')
  for (const { browserWindow } of windowCloseListeners) {
    try {
      // app.exit() bypasses window close events, so persist bounds first.
      saveWindowBounds(browserWindow)
    } catch (error) {
      console.error('Failed to save window bounds before update install', error)
    }
    // Close listeners that prevent default can make quitAndInstall() hang.
    browserWindow.removeAllListeners('close')
  }

  const beforeQuitForUpdate = () => {
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
  }
  autoUpdater.once('before-quit-for-update', beforeQuitForUpdate)

  let restored = false
  return () => {
    if (restored) return
    restored = true
    autoUpdater.removeListener('before-quit-for-update', beforeQuitForUpdate)
    for (const listener of beforeQuitListeners) {
      app.on('before-quit', listener)
    }
    for (const { browserWindow, listeners } of windowCloseListeners) {
      if (browserWindow.isDestroyed()) continue
      for (const listener of listeners) {
        browserWindow.on('close', listener)
      }
    }
  }
}
