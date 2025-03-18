import { shell, BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { proxyJsChannel, typeSafeWebContentsSend } from './channels'

export const viewRole = (
  mainWindow: BrowserWindow
): MenuItemConstructorOptions => {
  return {
    label: 'View',
    submenu: [
      {
        label: 'Learn More',
        click: async () => {
          await shell.openExternal('https://zoo.dev/docs')
        },
      },
      {
        label: 'Report an issue',
        click: async () => {
          await shell.openExternal(
            'https://github.com/KittyCAD/modeling-app/issues/new'
          )
        },
      },
    ],
  }
}
