import { app, Menu, BrowserWindow } from 'electron'
import { projectFileRole, modelingFileRole } from 'menu/fileRole'
import { projectEditRole, modelingEditRole } from 'menu/editRole'
import { helpRole } from 'menu/helpRole'
import { projectViewRole, modelingViewRole } from 'menu/viewRole'
import { modelingDesignRole } from 'menu/designRole'

import os from 'node:os'
import { ZooMenuItemConstructorOptions } from 'menu/roles'
const isMac = os.platform() === 'darwin'

/**
 * Gotcha
 * If you call Menu.setApplicationMenu([<file>,<edit>,<view>,<help>]) on Mac, it will turn <file> into <ApplicationName>
 * you need to create a new menu in the 0th index for the <ApplicationName> aka
 * Menu.setApplicationMenu([<ApplicationName>,<file>,<edit>,<view>,<help>])
 * If you do not do this, <file> will not show up as file. It will be the <ApplicationName> and it contents live under that Menu
 * The .setApplicationMenu does not tell you that the 0th index forces it to <ApplicationName> on Mac.
 */
function zooSetApplicationMenu (menu: Electron.Menu) {
  Menu.setApplicationMenu(menu)
}


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
    zooSetApplicationMenu(menu)
  } else {
    const menu = Menu.buildFromTemplate(templateNotMac)
    zooSetApplicationMenu(menu)
  }
}

function appMenuMacOnly () {
  let extraBits: ZooMenuItemConstructorOptions[] = []
    if (isMac) {
      extraBits =
        [{
          // @ts-ignore This is required for Mac's it will show the app name first. This is safe to ts-ignore, it is a string.
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
          { role: 'quit' }
        ]
      }]
  }
  return extraBits
}

// This will generate a new menu from the initial state
// All state management from the previous menu is going to be lost.
export function buildAndSetMenuForModelingPage(mainWindow: BrowserWindow) {
  const template = [
    // Expand empty elements for environments that are not Mac
    ...appMenuMacOnly(),
    modelingFileRole(mainWindow),
    modelingEditRole(mainWindow),
    modelingViewRole(mainWindow),
    modelingDesignRole(mainWindow),
    // Help role is the same for all pages
    helpRole(mainWindow),
  ]
  const menu = Menu.buildFromTemplate(template)
  zooSetApplicationMenu(menu)
}

// This will generate a new menu from the initial state
// All state management from the previous menu is going to be lost.
export function buildAndSetMenuForProjectPage(mainWindow: BrowserWindow) {
  const template = [
    // Expand empty elements for environments that are not Mac
    ...appMenuMacOnly(),
    projectFileRole(mainWindow),
    projectEditRole(mainWindow),
    projectViewRole(mainWindow),
    // Help role is the same for all pages
    helpRole(mainWindow),
  ]
  const menu = Menu.buildFromTemplate(template)
  zooSetApplicationMenu(menu)
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
