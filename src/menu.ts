import { modelingDesignRole } from '@src/menu/designRole'
import { modelingEditRole, projectEditRole } from '@src/menu/editRole'
import {
  type FileMenuActions,
  modelingFileRole,
  newWindowMenuItem,
  projectFileRole,
} from '@src/menu/fileRole'
import { helpRole } from '@src/menu/helpRole'
import type { ZooMenuItemConstructorOptions } from '@src/menu/roles'
import { isMac } from '@src/menu/utils'
import { modelingViewRole, projectViewRole } from '@src/menu/viewRole'
import type { BrowserWindow } from 'electron'
import { Menu, app } from 'electron'

type MenuWithMenuItemLookup = {
  getMenuItemById: (menuId: string) => { enabled: boolean } | null | undefined
}

/**
 * Gotcha
 * If you call Menu.setApplicationMenu([<file>,<edit>,<view>,<help>]) on Mac, it will turn <file> into <ApplicationName>
 * you need to create a new menu in the 0th index for the <ApplicationName> aka
 * Menu.setApplicationMenu([<ApplicationName>,<file>,<edit>,<view>,<help>])
 * If you do not do this, <file> will not show up as file. It will be the <ApplicationName> and it contents live under that Menu
 * The .setApplicationMenu does not tell you that the 0th index forces it to <ApplicationName> on Mac.
 */
function setNativeMenuForWindow(
  mainWindow: BrowserWindow,
  menu: Electron.Menu
) {
  if (isMac) {
    Menu.setApplicationMenu(menu)
  } else {
    mainWindow.setMenu(menu)
  }
}

// Menu for unauthenticated users
function fallbackFileRole(
  actions: FileMenuActions
): ZooMenuItemConstructorOptions {
  return {
    label: 'File',
    submenu: [
      // No project or settings items
      newWindowMenuItem(actions),
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  }
}

function fallbackEditRole(): ZooMenuItemConstructorOptions {
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
      // No project items
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

// Menu for authenticated users
export function buildAndSetMenuForFallback(
  mainWindow: BrowserWindow,
  actions: FileMenuActions
): Electron.Menu {
  // Use the same structure as the project page menu for consistency
  // but remove items that require authentication
  const template = [
    // Expand empty elements for environments that are not Mac
    ...appMenuMacOnly(),
    fallbackFileRole(actions),
    fallbackEditRole(),
    projectViewRole(mainWindow),
    // Help role is the same for all pages
    helpRole(mainWindow),
  ]
  const menu = Menu.buildFromTemplate(template)
  setNativeMenuForWindow(mainWindow, menu)
  return menu
}

function appMenuMacOnly() {
  let extraBits: ZooMenuItemConstructorOptions[] = []
  if (isMac) {
    extraBits = [
      {
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
          { role: 'quit' },
        ],
      },
    ]
  }
  return extraBits
}

// This will generate a new menu from the initial state
// All state management from the previous menu is going to be lost.
export function buildAndSetMenuForModelingPage(
  mainWindow: BrowserWindow,
  actions: FileMenuActions
): Electron.Menu {
  const template = [
    // Expand empty elements for environments that are not Mac
    ...appMenuMacOnly(),
    modelingFileRole(mainWindow, actions),
    modelingEditRole(mainWindow),
    modelingViewRole(mainWindow),
    modelingDesignRole(mainWindow),
    // Help role is the same for all pages
    helpRole(mainWindow),
  ]
  const menu = Menu.buildFromTemplate(template)
  setNativeMenuForWindow(mainWindow, menu)
  return menu
}

// This will generate a new menu from the initial state
// All state management from the previous menu is going to be lost.
export function buildAndSetMenuForProjectPage(
  mainWindow: BrowserWindow,
  actions: FileMenuActions
): Electron.Menu {
  const template = [
    // Expand empty elements for environments that are not Mac
    ...appMenuMacOnly(),
    projectFileRole(mainWindow, actions),
    projectEditRole(mainWindow),
    projectViewRole(mainWindow),
    // Help role is the same for all pages
    helpRole(mainWindow),
  ]
  const menu = Menu.buildFromTemplate(template)
  setNativeMenuForWindow(mainWindow, menu)
  return menu
}

// Try to enable the menu item on the provided native menu.
// It will not do anything if that menu cannot be found.
export function setMenuItemEnabled(
  menu: MenuWithMenuItemLookup | null | undefined,
  menuId: string,
  enabled: boolean
) {
  const menuItem = menu?.getMenuItemById(menuId)
  if (menuItem) {
    menuItem.enabled = enabled
  }
}
