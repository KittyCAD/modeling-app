import { BrowserWindow } from 'electron'
import os from 'node:os'
import { ZooMenuItemConstructorOptions } from './roles'
const isMac = os.platform() === 'darwin'
export const windowRole = (_: BrowserWindow): ZooMenuItemConstructorOptions => {
  return {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? [
            { type: 'separator' },
            { role: 'front' },
            { type: 'separator' },
            { role: 'window' },
          ]
        : [{ role: 'close' }]),
    ],
  }
}
