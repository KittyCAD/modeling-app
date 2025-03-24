import { BrowserWindow } from 'electron'
import { typeSafeWebContentsSend } from './channels'
import os from 'node:os'
import { ZooMenuItemConstructorOptions } from './roles'
const isMac = os.platform() === 'darwin'

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
        label: 'Rename project',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Rename project',
          })
        },
      },
      {
        label: 'Delete project',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Delete project',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Change project directory',
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
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Modify with Zoo Text-To-CAD',
          })
        },
      },
      {
        label: 'Edit parameter',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Edit parameter',
          })
        },
      },
      {
        label: 'Format code',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Format code',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Rename project',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Rename project',
          })
        },
      },
      {
        label: 'Delete project',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Edit.Delete project',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Change project directory',
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
