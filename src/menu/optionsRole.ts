import { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { proxyJsChannel, typeSafeWebContentsSend } from './channels'

export const optionsRole = (
  mainWindow: BrowserWindow
): MenuItemConstructorOptions => {
  return {
    label: 'Options',
    submenu: [
      {
        label: 'Report an issue',
        click: async () => {},
      },
    ],
  }
}
