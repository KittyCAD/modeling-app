import { shell, BrowserWindow } from 'electron'
import { ZooMenuItemConstructorOptions } from './roles'

export const viewRole = (_: BrowserWindow): ZooMenuItemConstructorOptions => {
  return {
    label: 'View',
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
            'https://github.com/KittyCAD/modeling-app/issues/new'
          )
        },
      },
    ],
  }
}
