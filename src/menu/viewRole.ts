import type { BrowserWindow } from 'electron'
import os from 'node:os'

import { typeSafeWebContentsSend } from '@src/menu/channels'
import type { ZooMenuItemConstructorOptions } from '@src/menu/roles'

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
        id: 'View.Command Palette...',
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
