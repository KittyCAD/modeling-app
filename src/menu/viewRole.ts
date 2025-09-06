import os from 'node:os'
import type { BrowserWindow } from 'electron'

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
      { role: 'toggleDevTools' },
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
        label: 'Orthographic View',
        id: 'View.Orthographic view',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'View.Orthographic view',
          })
        },
      },
      {
        label: 'Perspective View',
        id: 'View.Perspective view',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'View.Perspective view',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Standard Views',
        id: 'View.Standard views',
        submenu: [
          {
            label: 'Right View',
            id: 'View.Standard views.Right view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Right view',
              })
            },
          },
          {
            label: 'Back View',
            id: 'View.Standard views.Back view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Back view',
              })
            },
          },
          {
            label: 'Top View',
            id: 'View.Standard views.Top view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Top view',
              })
            },
          },
          {
            label: 'Left View',
            id: 'View.Standard views.Left view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Left view',
              })
            },
          },
          {
            label: 'Front View',
            id: 'View.Standard views.Front view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Front view',
              })
            },
          },
          {
            label: 'Bottom View',
            id: 'View.Standard views.Bottom view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Bottom view',
              })
            },
          },
          { type: 'separator' },
          {
            label: 'Reset View',
            id: 'View.Standard views.Reset view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Reset view',
              })
            },
          },
          {
            label: 'Center View on Selection',
            id: 'View.Standard views.Center view on selection',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Standard views.Center view on selection',
              })
            },
          },
        ],
      },
      {
        label: 'Named Views',
        id: 'View.Named views',
        submenu: [
          {
            label: 'Create Named View',
            id: 'View.Named views.Create named view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Named views.Create named view',
              })
            },
          },
          {
            label: 'Load Named View',
            id: 'View.Named views.Load named view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Named views.Load named view',
              })
            },
          },
          {
            label: 'Delete Named View',
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
      { role: 'toggleDevTools' },
      ...extraBits,
    ],
  }
}
