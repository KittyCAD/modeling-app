import { BrowserWindow } from 'electron'
import { ZooMenuItemConstructorOptions } from './roles'

export const utilityRole = (
  _: BrowserWindow
): ZooMenuItemConstructorOptions => {
  return {
    label: 'Utility',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  }
}
