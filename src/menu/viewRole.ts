import { BrowserWindow } from 'electron'
import { ZooMenuItemConstructorOptions } from './roles'
import { typeSafeWebContentsSend } from './channels'
import os from 'node:os'
const isMac = os.platform() === 'darwin'

export const projectViewRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
  let extraBits: ZooMenuItemConstructorOptions[] = [{ role: 'close' }]
  if (isMac) {
    extraBits = [
      { type: 'separator' },
      { role: 'front' },
      { type: 'separator' },
      { role: 'window' },
    ]
  }
  return {
    label: 'View',
    submenu: [
      {
        label: 'Command Palette...',
        id: 'View.Command Palette...',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'View.Command Palette...',
          })
        },
      },
      {
        label: 'Appearance',
        submenu: [
          { role: 'togglefullscreen' },
          { type: 'separator' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'resetZoom' },
        ],
      },
      { type: 'separator' },
      { role: 'minimize' },
      { role: 'zoom' },
      ...extraBits,
    ],
  }
}

export const modelingViewRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
  let extraBits: ZooMenuItemConstructorOptions[] = [{ role: 'close' }]
  if (isMac) {
    extraBits = [
      { type: 'separator' },
      { role: 'front' },
      { type: 'separator' },
      { role: 'window' },
    ]
  }
  return {
    label: 'View',
    submenu: [
      {
        label: 'Command Palette...',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'View.Command Palette...',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Orthographic view',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'View.Orthographic view',
          })
        },
      },
      {
        label: 'Perspective view',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'View.Perspective view',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Standard views',
        submenu: [
          {
            label: 'Right view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Right view',
              })
            },
          },
          {
            label: 'Back view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Back view',
              })
            },
          },

          {
            label: 'Top view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Top view',
              })
            },
          },

          {
            label: 'Left view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Left view',
              })
            },
          },

          {
            label: 'Front view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Front view',
              })
            },
          },

          {
            label: 'Bottom view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Bottom view',
              })
            },
          },
          { type: 'separator' },
          {
            label: 'Reset view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Reset view',
              })
            },
          },

          {
            label: 'Center view on selection',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Center view on selection',
              })
            },
          },
          {
            label: 'Refresh',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Refresh',
              })
            },
          },
        ],
      },
      {
        label: 'Named views',
        submenu: [
          {
            label: 'Create named view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Named views.Create named view',
              })
            },
          },

          {
            label: 'List named views',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Named views.List named views',
              })
            },
          },

          {
            label: 'Delete named view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Named views.Delete named view',
              })
            },
          },
        ],
      },
      { type: 'separator' },
      {
        label: 'Panes',
        submenu: [
          {
            label: 'Feature tree',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Panes.Feature true',
              })
            },
          },
          {
            label: 'KCL code',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Panes.KCL code',
              })
            },
          },
          {
            label: 'Project files',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Panes.Project files',
              })
            },
          },
          {
            label: 'Variables',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Panes.Variables',
              })
            },
          },
          {
            label: 'Logs',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Panes.Logs',
              })
            },
          },
          {
            label: 'Debug',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Panes.Debug',
              })
            },
          },
        ],
      },
      {
        label: 'Appearance',
        submenu: [
          { role: 'togglefullscreen' },
          { type: 'separator' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'resetZoom' },
        ],
      },
      { type: 'separator' },
      { role: 'minimize' },
      { role: 'zoom' },
      ...extraBits,
    ],
  }
}
