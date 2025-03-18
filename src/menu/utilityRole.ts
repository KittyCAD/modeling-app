import { BrowserWindow } from 'electron'
import { proxyJsChannel, typeSafeWebContentsSend } from './channels'
import { MenuItemConstructorOptions } from 'electron/main'

export const utilityRole = (
  mainWindow: BrowserWindow
): MenuItemConstructorOptions => {
  return {
    label: 'Utility',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  }
}
