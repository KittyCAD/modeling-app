import type { BrowserWindow } from 'electron'
import os from 'node:os'

import { typeSafeWebContentsSend } from '@src/menu/channels'
import type { ZooMenuItemConstructorOptions } from '@src/menu/roles'

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
        id: 'View.Command Palette...',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'View.Command Palette...',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Orthographic view',
        id: 'View.Orthographic view',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'View.Orthographic view',
          })
        },
      },
      {
        label: 'Perspective view',
        id: 'View.Perspective view',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'View.Perspective view',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Standard views',
        id: 'View.Standard views',
        submenu: [
          {
            label: 'Right view',
            id: 'View.Standard views.Right view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Right view',
              })
            },
          },
          {
            label: 'Back view',
            id: 'View.Standard views.Back view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Back view',
              })
            },
          },

          {
            label: 'Top view',
            id: 'View.Standard views.Top view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Top view',
              })
            },
          },

          {
            label: 'Left view',
            id: 'View.Standard views.Left view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Left view',
              })
            },
          },

          {
            label: 'Front view',
            id: 'View.Standard views.Front view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Front view',
              })
            },
          },

          {
            label: 'Bottom view',
            id: 'View.Standard views.Bottom view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Bottom view',
              })
            },
          },
          { type: 'separator' },
          {
            label: 'Reset view',
            id: 'View.Standard views.Reset view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Reset view',
              })
            },
          },

          {
            label: 'Center view on selection',
            id: 'View.Standard views.Center view on selection',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Center view on selection',
              })
            },
          },
          {
            label: 'Refresh',
            id: 'View.Standard views.Refresh',
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
        id: 'View.Named views',
        submenu: [
          {
            label: 'Create named view',
            id: 'View.Named views.Create named view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Named views.Create named view',
              })
            },
          },

          {
            label: 'Load named view',
            id: 'View.Named views.Load named view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Named views.Load named view',
              })
            },
          },

          {
            label: 'Delete named view',
            id: 'View.Named views.Delete named view',
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
            id: 'View.Panes.Feature tree',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Panes.Feature tree',
              })
            },
          },
          {
            label: 'KCL code',
            id: 'View.Panes.KCL code',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Panes.KCL code',
              })
            },
          },
          {
            label: 'Project files',
            id: 'View.Panes.Project files',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Panes.Project files',
              })
            },
          },
          {
            label: 'Variables',
            id: 'View.Panes.Variables',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Panes.Variables',
              })
            },
          },
          {
            label: 'Logs',
            id: 'View.Panes.Logs',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Panes.Logs',
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
