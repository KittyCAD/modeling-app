import { shell, BrowserWindow } from 'electron'
import { ZooMenuItemConstructorOptions } from './roles'
import { reportRejection } from 'lib/trap'
import { typeSafeWebContentsSend } from './channels'
import os from 'node:os'
const isMac = os.platform() === 'darwin'

export const projectViewRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
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
