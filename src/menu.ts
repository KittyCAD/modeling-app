import { app, Menu, shell, BrowserWindow } from 'electron'
import { fileRole, projectFileRole } from 'menu/fileRole'
import { editRole } from 'menu/editRole'
import { optionsRole } from 'menu/optionsRole'
import { utilityRole } from 'menu/utilityRole'
import { viewRole } from 'menu/viewRole'
import { windowRole } from 'menu/windowRole'
import { helpRole } from 'menu/helpRole'

import os from 'node:os'
const isMac = os.platform() === 'darwin'

// File Page

const file_FileRole = [
  'new',
  'new from template',
  'open',
  'save',
  'save as',
  'save all',
  'import',
  'export',
  'print',
  'print preview',
  'close',
  'quit',
  'recent files',
]

const file_OptionsRole = [
  'application preferences',
  'current drawing preferences',
  'widget options',
  'device options',
  'reload style sheet',
]

const file_EditRole = [
  'selection pointer',
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'delete selected',
]

const file_ViewRole = [
  'Fullscreen F11',
  'status bar',
  'grid',
  'draft',
  'redraw',
  'zoom in',
  'zoom out',
  'auto zoom',
  'previous view',
  'window zoom',
  'zoom panning',
]

const file_ToolsRole = [
  'line',
  'circle',
  'curve',
  'ellipse',
  'polyline',
  'select',
  'dimension',
  'modify',
  'info',
  'order',
]

const file_WidgetsRole = [
  'dock areas',
  'dock widgets',
  'toolbars',
  'menu creator',
  'toolbar creator',
]

const file_HelpRole = ['about', 'license']

function buildTemplate(mainWindow: BrowserWindow) {
  const template = [
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
    helpRole(mainWindow),
  ]

  return template
}

function buildProjectTemplate(mainWindow: BrowserWindow) {
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
  return template
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
      helpRole(mainWindow)
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

export function buildAndSetMenuForProjectPage(mainWindow: BrowserWindow) {
  const template = [
    projectFileRole(mainWindow),
    editRole(mainWindow),
    optionsRole(mainWindow),
    windowRole(mainWindow),
    utilityRole(mainWindow),
    // Help role is the same for all pages
    helpRole(mainWindow)
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
