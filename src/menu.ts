import { app, Menu, shell, BrowserWindow } from 'electron'
import { fileRole, projectFileRole } from 'menu/fileRole'
import { editRole, projectEditRole } from 'menu/editRole'
import { optionsRole } from 'menu/optionsRole'
import { utilityRole } from 'menu/utilityRole'
import { viewRole } from 'menu/viewRole'
import { windowRole } from 'menu/windowRole'
import { helpRole } from 'menu/helpRole'

import os from 'node:os'
const isMac = os.platform() === 'darwin'

// Default electron menu.
export function buildAndSetMenuForFallback(mainWindow: BrowserWindow) {
  const template = [
    // { role: 'appMenu' }
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    // { role: 'fileMenu' }
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    // { role: 'editMenu' }
    {
      label: 'Edit',
      submenu: [
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
    },
    // { role: 'viewMenu' }
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    // { role: 'windowMenu' }
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' },
            ]
          : [{ role: 'close' }]),
      ],
    },
    helpRole(mainWindow),
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

export function buildAndSetMenuForModelingPage(mainWindow: BrowserWindow) {
  const template = [
    // fileRole(mainWindow),
    // editRole(mainWindow),
    // viewRole(mainWindow),
    // optionsRole(mainWindow),
    // windowRole(mainWindow),
    // utilityRole(mainWindow),
    // Help role is the same for all pages
    helpRole(mainWindow),
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

export function buildAndSetMenuForProjectPage(mainWindow: BrowserWindow, key? : string, enabled? : boolean) {
  const template = [
    projectFileRole(mainWindow),
    projectEditRole(mainWindow),
    optionsRole(mainWindow),
    windowRole(mainWindow),
    utilityRole(mainWindow),
    // Help role is the same for all pages
    helpRole(mainWindow),
  ]

  if (key && (enabled !== undefined && enabled !== null)) {
    const labelPath = key.split(".")
    // find root role
    const roleIndex = template.findIndex((role)=>{
      return role.label === labelPath[0]
    })

    if (roleIndex !== -1) {
      let submenu = template[roleIndex].submenu
      const actionIndex = submenu.findIndex((action)=>{
        return action.label === labelPath[1]
      })
      if (actionIndex !== -1) {
        template[roleIndex].submenu[actionIndex].enabled = enabled
      }
      // TODO: interative case
    }
  }
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
