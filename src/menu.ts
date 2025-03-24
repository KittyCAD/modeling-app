import { app, Menu, BrowserWindow } from 'electron'
import { projectFileRole, modelingFileRole } from 'menu/fileRole'
import { projectEditRole, modelingEditRole } from 'menu/editRole'
import { helpRole } from 'menu/helpRole'
import { projectViewRole, modelingViewRole } from 'menu/viewRole'
import { modelingDesignRole} from 'menu/designRole'

import os from 'node:os'
import { ZooMenuItemConstructorOptions } from 'menu/roles'
const isMac = os.platform() === 'darwin'

// Default electron menu.
export function buildAndSetMenuForFallback(mainWindow: BrowserWindow) {
  const templateMac: ZooMenuItemConstructorOptions[] = [
    {
      // @ts-ignore cannot determine this since it is dynamic. It is still a string, not a problem.
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
    {
      label: 'File',
      submenu: [{ role: 'close' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Speech',
          submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
        },
      ],
    },
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
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' },
      ],
    },
  ]

  const templateNotMac: ZooMenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
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

    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
    },
    helpRole(mainWindow),
  ]

  if (isMac) {
    const menu = Menu.buildFromTemplate(templateMac)
    Menu.setApplicationMenu(menu)
  } else {
    const menu = Menu.buildFromTemplate(templateNotMac)
    Menu.setApplicationMenu(menu)
  }
}
// This will generate a new menu from the initial state
// All state management from the previous menu is going to be lost.
export function buildAndSetMenuForModelingPage(mainWindow: BrowserWindow) {
  const template = [
    modelingFileRole(mainWindow),
    modelingEditRole(mainWindow),
    modelingViewRole(mainWindow),
    modelingDesignRole(mainWindow),
    // Help role is the same for all pages
    helpRole(mainWindow),
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// This will generate a new menu from the initial state
// All state management from the previous menu is going to be lost.
export function buildAndSetMenuForProjectPage(mainWindow: BrowserWindow) {
  const template = [
    projectFileRole(mainWindow),
    projectEditRole(mainWindow),
    projectViewRole(mainWindow),
    // Help role is the same for all pages
    helpRole(mainWindow),
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// Try to enable the menu based on the application menu
// It will not do anything if that menu cannot be found.
export function enableMenu(menuId: string) {
  const applicationMenu = Menu.getApplicationMenu()
  const menuItem = applicationMenu?.getMenuItemById(menuId)
  if (menuItem) {
    menuItem.enabled = true
  }
}

// Try to disable the menu based on the application menu
// It will not do anything if that menu cannot be found.
export function disableMenu(menuId: string) {
  const applicationMenu = Menu.getApplicationMenu()
  const menuItem = applicationMenu?.getMenuItemById(menuId)
  if (menuItem) {
    menuItem.enabled = false
  }
}
