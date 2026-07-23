import type { BrowserWindow } from 'electron'

import { sendMenuAction } from '@src/menu/channels'
import type { ZooMenuItemConstructorOptions } from '@src/menu/roles'
import { isMac } from '@src/menu/utils'

export type FileMenuActions = {
  openNewWindow: () => void
}

export const newWindowMenuItem = ({
  openNewWindow,
}: FileMenuActions): ZooMenuItemConstructorOptions => ({
  label: 'New Window',
  id: 'File.New window',
  accelerator: 'CommandOrControl+Shift+N',
  click: openNewWindow,
})

export const projectFileRole = (
  mainWindow: BrowserWindow,
  actions: FileMenuActions
): ZooMenuItemConstructorOptions => {
  return {
    label: 'File',
    submenu: [
      newWindowMenuItem(actions),
      { type: 'separator' },
      {
        label: 'Create Project',
        id: 'File.Create project',
        accelerator: 'CommandOrControl+N',
        click: sendMenuAction(mainWindow, 'File.Create project'),
      },
      {
        label: 'Open Project',
        id: 'File.Open project',
        accelerator: 'CommandOrControl+P',
        click: sendMenuAction(mainWindow, 'File.Open project'),
      },
      // TODO electronjs dot org/docs/latest/tutorial/recent-documents
      // Appears to be only Windows and Mac OS specific. Linux does not have support
      { type: 'separator' },
      {
        label: 'Add File to Project',
        id: 'File.Add file to project',
        click: sendMenuAction(mainWindow, 'File.Add file to project'),
      },
      { type: 'separator' },
      {
        label: 'Preferences',
        submenu: [
          {
            label: 'User Settings',
            id: 'File.Preferences.User settings',
            click: sendMenuAction(mainWindow, 'File.Preferences.User settings'),
          },
          {
            label: 'Keybindings',
            id: 'File.Preferences.Keybindings',
            click: sendMenuAction(mainWindow, 'File.Preferences.Keybindings'),
          },
          {
            label: 'User Default Units',
            id: 'File.Preferences.User default units',
            click: sendMenuAction(
              mainWindow,
              'File.Preferences.User default units'
            ),
          },
          {
            label: 'Theme',
            id: 'File.Preferences.Theme',
            click: sendMenuAction(mainWindow, 'File.Preferences.Theme'),
          },
        ],
      },
      { type: 'separator' },
      // Last in list
      {
        label: 'Sign Out',
        id: 'File.Sign out',
        click: sendMenuAction(mainWindow, 'File.Sign out'),
      },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  }
}

export const modelingFileRole = (
  mainWindow: BrowserWindow,
  actions: FileMenuActions
): ZooMenuItemConstructorOptions => {
  return {
    label: 'File',
    submenu: [
      newWindowMenuItem(actions),
      { type: 'separator' },
      // TODO: Once a safe command bar create new file and folder is implemented we can turn these on
      {
        label: 'Create Project',
        id: 'File.Create project',
        accelerator: 'CommandOrControl+N',
        click: sendMenuAction(mainWindow, 'File.Create project'),
      },
      {
        label: 'Duplicate Project',
        id: 'File.Duplicate project',
        click: sendMenuAction(mainWindow, 'File.Duplicate project'),
      },
      {
        label: 'Open Project',
        id: 'File.Open project',
        accelerator: 'CommandOrControl+P',
        click: sendMenuAction(mainWindow, 'File.Open project'),
      },
      // TODO electronjs dot org/docs/latest/tutorial/recent-documents
      // Appears to be only Windows and Mac OS specific. Linux does not have support
      { type: 'separator' },
      {
        label: 'Add File to Project',
        id: 'File.Add file to project',
        click: sendMenuAction(mainWindow, 'File.Add file to project'),
      },
      {
        label: 'Export Current Part',
        id: 'File.Export current part',
        click: sendMenuAction(mainWindow, 'File.Export current part'),
      },
      { type: 'separator' },
      {
        label: 'Preferences',
        submenu: [
          {
            label: 'Project Settings',
            id: 'File.Preferences.Project settings',
            click: sendMenuAction(
              mainWindow,
              'File.Preferences.Project settings'
            ),
          },
          {
            label: 'User Settings',
            id: 'File.Preferences.User settings',
            click: sendMenuAction(mainWindow, 'File.Preferences.User settings'),
          },
          {
            label: 'Keybindings',
            id: 'File.Preferences.Keybindings',
            click: sendMenuAction(mainWindow, 'File.Preferences.Keybindings'),
          },
          {
            label: 'User Default Units',
            id: 'File.Preferences.User default units',
            click: sendMenuAction(
              mainWindow,
              'File.Preferences.User default units'
            ),
          },
          {
            label: 'Theme',
            id: 'File.Preferences.Theme',
            click: sendMenuAction(mainWindow, 'File.Preferences.Theme'),
          },
        ],
      },
      { type: 'separator' },
      // Last in list
      {
        label: 'Sign Out',
        id: 'File.Sign out',
        click: sendMenuAction(mainWindow, 'File.Sign out'),
      },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  }
}
