import { BrowserWindow } from 'electron'
import { typeSafeWebContentsSend } from './channels'
import { ZooMenuItemConstructorOptions } from './roles'
import os from 'node:os'
const isMac = os.platform() === 'darwin'

export const projectFileRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
  return {
    label: 'File',
    submenu: [
      {
        label: 'New project',
        id: 'File.New project',
        accelerator: 'CommandOrControl+N',
        click: async () => {
          typeSafeWebContentsSend(mainWindow, 'File.New project')
        },
      },
      {
        label: 'Open project',
        accelerator: 'CommandOrControl+P',
        click: async () => {
          typeSafeWebContentsSend(mainWindow, 'File.Open project')
        },
      },
      // TODO https://www.electronjs.org/docs/latest/tutorial/recent-documents
      { type: 'separator' },
      {
        label: 'Import file from URL',
        click: async () => {
          mainWindow.webContents.send('File.Import file from URL')
        },
      },
      { type: 'separator' },
      {
        label: 'Preferences',
        submenu: [
          {
            label: 'User settings',
            click: async () => {
              mainWindow.webContents.send('File.Preferences.User settings')
            },
          },
          {
            label: 'Keybindings',
            click: async () => {
              mainWindow.webContents.send('File.Preferences.Keybindings')
            },
          },
        ],
      },
      { type: 'separator' },
      // Last in list
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  }
}
