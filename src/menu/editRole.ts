import { BrowserWindow } from 'electron'
import { typeSafeWebContentsSend } from './channels'
import os from 'node:os'
import { ZooMenuItemConstructorOptions } from './roles'
const isMac = os.platform() === 'darwin'

export const projectEditRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
  return {
    label: 'Edit',
    submenu: [
      {
        label: 'Rename project',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'Edit.Rename project')
        },
      },
      {
        label: 'Delete project',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'Edit.Delete project')
        },
      },
      { type: 'separator' },
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac
        ? [
            { role: 'pasteAndMatchStyle' },
            { role: 'delete' },
            { role: 'selectAll' },
            { type: 'separator' },
            {
              label: 'Speech',
              submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
            },
          ]
        : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
    ],
  }
}
