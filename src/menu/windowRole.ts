import { BrowserWindow } from 'electron'
import os from 'node:os'
import { ZooMenuItemConstructorOptions } from './roles'
const isMac = os.platform() === 'darwin'
export const windowRole = (_: BrowserWindow): ZooMenuItemConstructorOptions => {
  let extraBits: ZooMenuItemConstructorOptions[] = [{ role: 'close' }]
  if (isMac) {
    extraBits = [
      { type: 'separator' },
      { role: 'front' },
      { type: 'separator' },
      { role: 'window' },
    ]
  }
  return {
    label: 'Window',
    submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...extraBits],
  }
}
