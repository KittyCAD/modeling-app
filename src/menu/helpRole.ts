import { shell, BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { proxyJsChannel, typeSafeWebContentsSend } from './channels'

export const helpRole = (
  mainWindow: BrowserWindow
): MenuItemConstructorOptions => {
  return {
    label: 'Help',
    submenu: [
      {
        label: 'Learn more',
        click: async () => {
          await shell.openExternal('https://zoo.dev/docs')
        },
      },
      {
        label: 'Report an issue',
        click: async () => {
          await shell.openExternal(
            'https://github.com/KittyCAD/modeling-app/issues/new/choose'
          )
        },
      },
      {
        label: 'Ask the community discord',
        click: async () => {
          await shell.openExternal('https://discord.gg/JQEpHR7Nt2')
        }
      },
      {
        label: 'Ask the community discourse',
        click: async () => {
          await shell.openExternal('https://community.zoo.dev/')
        }
      },
      {
        label: 'Release notes',
        click: async () => {
          await shell.openExternal('https://github.com/KittyCAD/modeling-app/releases')
        }
    },
 ]
  }
}
