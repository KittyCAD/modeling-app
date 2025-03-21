import { BrowserWindow } from 'electron'
import { ZooMenuItemConstructorOptions } from './roles'
import { typeSafeWebContentsSend } from './channels'
import os from 'node:os'
const isMac = os.platform() === 'darwin'

export const projectViewRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
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
    label: 'View',
    submenu: [
      {
        label: 'Command Palette...',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'View.Command Palette...',
          })
        },
      },
      {
        label: 'Appearance',
        submenu: [
          { role: 'togglefullscreen' },
          { type: 'separator' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'resetZoom' },
        ],
      },
      { type: 'separator' },
      { role: 'minimize' },
      { role: 'zoom' },
      ...extraBits,
    ],
  }
}
