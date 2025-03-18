
import { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { proxyJsChannel, typeSafeWebContentsSend } from './channels'
import os from 'node:os'
const isMac = os.platform() === 'darwin'

export const fileRole = (
  mainWindow: BrowserWindow
): MenuItemConstructorOptions => {
  return {
    label: 'File',
    submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
  }
}


export const projectFileRole = (
  mainWindow: BrowserWindow
): MenuItemConstructorOptions => {
  return {
    label: 'File',
    submenu: [
      {
        label: 'New project',
        click: async () => {
          // CMD bar
          mainWindow.webContents.send('File.New project')
        }
      },
      {
        label: 'Open project',
        click: async () => {
          // CMD bar
          mainWindow.webContents.send('File.Open project')
        }
      },

      { type: 'separator' },
      // Last in list
      isMac ? { role: 'close' } : { role: 'quit' }
    ],
  }
}
