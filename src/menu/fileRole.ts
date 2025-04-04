import type { BrowserWindow } from 'electron'
import os from 'node:os'

import { typeSafeWebContentsSend } from '@src/menu/channels'
import type { ZooMenuItemConstructorOptions } from '@src/menu/roles'

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
        id: 'File.Open project',
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
        label: 'Preferences',
        submenu: [
          {
            label: 'User settings',
            id: 'File.Preferences.User settings',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'File.Preferences.User settings',
              })
            },
          },
          {
            label: 'Keybindings',
            id: 'File.Preferences.Keybindings',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'File.Preferences.Keybindings',
              })
            },
          },
          {
            label: 'User default units',
            id: 'File.Preferences.User default units',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'File.Preferences.User default units',
              })
            },
          },
          {
            label: 'Theme',
            id: 'File.Preferences.Theme',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'File.Preferences.Theme',
              })
            },
          },
          {
            label: 'Theme color',
            id: 'File.Preferences.Theme color',
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
        id: 'File.Sign out',
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

export const modelingFileRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
  return {
    label: 'File',
    submenu: [
      // TODO: Once a safe command bar create new file and folder is implemented we can turn these on
      // {
      //   label: 'Create new file',
      //   click: () => {
      //     typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
      //       menuLabel: 'File.Create new file',
      //     })
      //   },
      // },
      // {
      //   label: 'Create new folder',
      //   click: () => {
      //     typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
      //       menuLabel: 'File.Create new folder',
      //     })
      //   },
      // },
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
        id: 'File.Open project',
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
        label: 'Load a sample model',
        id: 'File.Load a sample model',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'File.Load a sample model',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Export current part',
        id: 'File.Export current part',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'File.Export current part',
          })
        },
      },
      {
        label: 'Share current part (via Zoo link)',
        id: 'File.Share current part (via Zoo link)',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'File.Share current part (via Zoo link)',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Preferences',
        submenu: [
          {
            label: 'Project settings',
            id: 'File.Preferences.Project settings',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'File.Preferences.Project settings',
              })
            },
          },
          {
            label: 'User settings',
            id: 'File.Preferences.User settings',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'File.Preferences.User settings',
              })
            },
          },
          {
            label: 'Keybindings',
            id: 'File.Preferences.Keybindings',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'File.Preferences.Keybindings',
              })
            },
          },
          {
            label: 'User default units',
            id: 'File.Preferences.User default units',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'File.Preferences.User default units',
              })
            },
          },
          {
            label: 'Theme',
            id: 'File.Preferences.Theme',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'File.Preferences.Theme',
              })
            },
          },
          {
            label: 'Theme color',
            id: 'File.Preferences.Theme color',
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
        id: 'File.Sign out',
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
