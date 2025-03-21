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
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'File.New project',
          })
        },
      },
      {
        label: 'Open project',
        accelerator: 'CommandOrControl+P',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'File.Open project',
          })
        },
      },
      // TODO https://www.electronjs.org/docs/latest/tutorial/recent-documents
      // Appears to be only Windows and Mac OS specific. Linux does not have support
      { type: 'separator' },
      {
        label: 'Import file from URL',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'File.Import file from URL',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Preferences',
        submenu: [
          {
            label: 'User settings',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'File.Preferences.User settings',
              })
            },
          },
          {
            label: 'Keybindings',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'File.Preferences.Keybindings',
              })
            },
          },
          {
            label: 'Theme',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'File.Preferences.Theme',
              })
            },
          },
          {
            label: 'Theme color',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'File.Preferences.Theme color',
              })
            },
          },
        ],
      },
      { type: 'separator' },
      // Last in list
      {
        label: 'Sign out',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'File.Sign out',
          })
        },
      },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  }
}
