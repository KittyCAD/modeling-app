import type { BrowserWindow } from 'electron'

import { typeSafeWebContentsSend } from '@src/menu/channels'
import type { ZooMenuItemConstructorOptions } from '@src/menu/roles'
import { isMac, isStagingOrDebug } from '@src/menu/utils'

export const projectFileRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
  return {
    label: 'File',
    submenu: [
      {
        label: 'Create Project',
        id: 'File.Create project',
        accelerator: 'CommandOrControl+N',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'File.Create project',
          })
        },
      },
      {
        label: 'Open Project',
        id: 'File.Open project',
        accelerator: 'CommandOrControl+P',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'File.Open project',
          })
        },
      },
      // TODO electronjs dot org/docs/latest/tutorial/recent-documents
      // Appears to be only Windows and Mac OS specific. Linux does not have support
      { type: 'separator' },
      {
        label: 'Add File to Project',
        id: 'File.Add file to project',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'File.Add file to project',
          })
        },
      },
      {
        label: 'Create with Zoo Text-To-CAD',
        id: 'Design.Create with Zoo Text-To-CAD',
        enabled: !isStagingOrDebug,
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Design.Create with Zoo Text-To-CAD',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Preferences',
        submenu: [
          {
            label: 'User Settings',
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
            label: 'User Default Units',
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
        ],
      },
      { type: 'separator' },
      // Last in list
      {
        label: 'Sign Out',
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
      //   label: 'Create New File',
      //   click: () => {
      //     typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
      //       menuLabel: 'File.Create new file',
      //     })
      //   },
      // },
      // {
      //   label: 'Create New Folder',
      //   click: () => {
      //     typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
      //       menuLabel: 'File.Create new folder',
      //     })
      //   },
      // },
      {
        label: 'Create Project',
        id: 'File.Create project',
        accelerator: 'CommandOrControl+N',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'File.Create project',
          })
        },
      },
      {
        label: 'Open Project',
        id: 'File.Open project',
        accelerator: 'CommandOrControl+P',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'File.Open project',
          })
        },
      },
      // TODO electronjs dot org/docs/latest/tutorial/recent-documents
      // Appears to be only Windows and Mac OS specific. Linux does not have support
      { type: 'separator' },
      {
        label: 'Add File to Project',
        id: 'File.Add file to project',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'File.Add file to project',
          })
        },
      },
      {
        label: 'Export Current Part',
        id: 'File.Export current part',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'File.Export current part',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Preferences',
        submenu: [
          {
            label: 'Project Settings',
            id: 'File.Preferences.Project settings',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'File.Preferences.Project settings',
              })
            },
          },
          {
            label: 'User Settings',
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
            label: 'User Default Units',
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
        ],
      },
      { type: 'separator' },
      // Last in list
      {
        label: 'Sign Out',
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
