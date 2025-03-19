import { shell, BrowserWindow } from 'electron'
import { ZooMenuItemConstructorOptions } from './roles'
import { reportRejection } from 'lib/trap'

export const viewRole = (_: BrowserWindow): ZooMenuItemConstructorOptions => {
  return {
    label: 'View',
    submenu: [
      {
        label: 'Learn more',
        click: () => {
          shell.openExternal('https://zoo.dev/docs').catch(reportRejection)
        },
      },
      {
        label: 'Report an issue',
        click: () => {
          shell.openExternal(
            'https://github.com/KittyCAD/modeling-app/issues/new'
          ).catch(reportRejection)
        },
      },
    ],
  }
}
