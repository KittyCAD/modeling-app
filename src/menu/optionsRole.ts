import { BrowserWindow } from 'electron'
import { ZooMenuItemConstructorOptions } from './roles'

export const optionsRole = (
  _: BrowserWindow
): ZooMenuItemConstructorOptions => {
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
