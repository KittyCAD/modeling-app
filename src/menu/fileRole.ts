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
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'File.New project')
        },
      },
      {
        label: 'Open project',
        accelerator: 'CommandOrControl+P',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'File.Open project')
        },
      },
      // TODO https://www.electronjs.org/docs/latest/tutorial/recent-documents
      { type: 'separator' },
      {
        label: 'Import file from URL',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'File.Import file from URL')
        },
      },
      { type: 'separator' },
      {
        label: 'Preferences',
        submenu: [
          {
            label: 'User settings',
            click: () => {
              typeSafeWebContentsSend(
                mainWindow,
                'File.Preferences.User settings'
              )
            },
          },
          {
            label: 'Keybindings',
            click: () => {
              typeSafeWebContentsSend(
                mainWindow,
                'File.Preferences.Keybindings'
              )
            },
          },
        ],
      },
      { type: 'separator' },
      // Last in list
      {
        label: 'Sign out',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'File.Sign out')
        },
      },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  }
}
