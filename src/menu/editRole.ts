import type { BrowserWindow } from 'electron'

import { typeSafeWebContentsSend } from '@src/menu/channels'
import type { ZooMenuItemConstructorOptions } from '@src/menu/roles'
import { isMac } from '@src/menu/utils'

export const projectEditRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
  let extraBits: ZooMenuItemConstructorOptions[] = [
    { role: 'delete' },
    { type: 'separator' },
    { role: 'selectAll' },
  ]
  if (isMac) {
    extraBits = [
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
      { type: 'separator' },
      {
        label: 'Speech',
        submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
      },
    ]
  }
  return {
    label: 'Edit',
    submenu: [
      {
        label: 'Rename Project',
        id: 'Edit.Rename project',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Rename project',
          })
        },
      },
      {
        label: 'Delete Project',
        id: 'Edit.Delete project',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Delete project',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Change Project Directory',
        id: 'Edit.Change project directory',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Change project directory',
          })
        },
      },
      { type: 'separator' },
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...extraBits,
    ],
  }
}

export const modelingEditRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
  let extraBits: ZooMenuItemConstructorOptions[] = [
    { role: 'delete' },
    { type: 'separator' },
    { role: 'selectAll' },
  ]
  if (isMac) {
    extraBits = [
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
      { type: 'separator' },
      {
        label: 'Speech',
        submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
      },
    ]
  }
  return {
    label: 'Edit',
    submenu: [
      {
        label: 'Modify with Zoo Text-To-CAD',
        id: 'Edit.Modify with Zoo Text-To-CAD',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Modify with Zoo Text-To-CAD',
          })
        },
      },
      {
        label: 'Edit Parameter',
        id: 'Edit.Edit parameter',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Edit parameter',
          })
        },
      },
      {
        label: 'Format Code',
        id: 'Edit.Format code',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Format code',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Rename Project',
        id: 'Edit.Rename project',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Rename project',
          })
        },
      },
      {
        label: 'Delete Project',
        id: 'Edit.Delete project',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Delete project',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Change Project Directory',
        id: 'Edit.Change project directory',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Change project directory',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Undo',
        accelerator: 'CmdOrCtrl+Z',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Undo',
          })
        },
      },
      {
        label: 'Redo',
        accelerator: 'Shift+CmdOrCtrl+Z',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Redo',
          })
        },
      },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...extraBits,
    ],
  }
}
