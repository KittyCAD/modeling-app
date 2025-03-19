import { app, Menu, BrowserWindow } from 'electron'
import { projectFileRole } from 'menu/fileRole'
import { projectEditRole } from 'menu/editRole'
import { optionsRole } from 'menu/optionsRole'
import { utilityRole } from 'menu/utilityRole'
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

// This will generate a new menu from the initial state
// All state management from the previous menu is going to be lost.
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

// This will generate a new menu from the initial state
// All state management from the previous menu is going to be lost.
export function buildAndSetMenuForProjectPage(mainWindow: BrowserWindow) {
  const template = [
    projectFileRole(mainWindow),
    projectEditRole(mainWindow),
    optionsRole(mainWindow),
    windowRole(mainWindow),
    utilityRole(mainWindow),
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
