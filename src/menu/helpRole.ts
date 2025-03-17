import { shell, BrowserWindow } from 'electron'
import { proxyJsChannel, typeSafeWebContentsSend } from "./channels"
import {ZooMenuItemConstructorOptions} from "./roles"

export const helpRole = (mainWindow: BrowserWindow) : ZooMenuItemConstructorOptions => {
  return {
    label: 'help',
    submenu: [
      {
        label: 'Learn More',
        click: async () => {
          await shell.openExternal('https://zoo.dev/docs')
        }
      },
      {
        label: 'proxy js',
        click: async () => {
          typeSafeWebContentsSend(mainWindow, 'help.proxy js')
        }
      }
    ]
  }
}
