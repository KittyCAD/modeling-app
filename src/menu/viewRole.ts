import type { BrowserWindow } from 'electron'

import { sendMenuAction } from '@src/menu/channels'
import type { ZooMenuItemConstructorOptions } from '@src/menu/roles'
import { isMac } from '@src/menu/utils'

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
        click: sendMenuAction(mainWindow, 'View.Command Palette...'),
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
        click: sendMenuAction(mainWindow, 'View.Command Palette...'),
      },
      { type: 'separator' },
      {
        label: 'Orthographic View',
        id: 'View.Orthographic view',
        click: sendMenuAction(mainWindow, 'View.Orthographic view'),
      },
      {
        label: 'Perspective View',
        id: 'View.Perspective view',
        click: sendMenuAction(mainWindow, 'View.Perspective view'),
      },
      { type: 'separator' },
      {
        label: 'Standard Views',
        id: 'View.Standard views',
        submenu: [
          {
            label: 'Right View',
            id: 'View.Standard views.Right view',
            click: sendMenuAction(mainWindow, 'View.Standard views.Right view'),
          },
          {
            label: 'Back View',
            id: 'View.Standard views.Back view',
            click: sendMenuAction(mainWindow, 'View.Standard views.Back view'),
          },
          {
            label: 'Top View',
            id: 'View.Standard views.Top view',
            click: sendMenuAction(mainWindow, 'View.Standard views.Top view'),
          },
          {
            label: 'Left View',
            id: 'View.Standard views.Left view',
            click: sendMenuAction(mainWindow, 'View.Standard views.Left view'),
          },
          {
            label: 'Front View',
            id: 'View.Standard views.Front view',
            click: sendMenuAction(mainWindow, 'View.Standard views.Front view'),
          },
          {
            label: 'Bottom View',
            id: 'View.Standard views.Bottom view',
            click: sendMenuAction(
              mainWindow,
              'View.Standard views.Bottom view'
            ),
          },
          { type: 'separator' },
          {
            label: 'Reset View',
            id: 'View.Standard views.Reset view',
            click: sendMenuAction(mainWindow, 'View.Standard views.Reset view'),
          },
          {
            label: 'Center View on Selection',
            id: 'View.Standard views.Center view on selection',
            click: sendMenuAction(
              mainWindow,
              'View.Standard views.Center view on selection'
            ),
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
            click: sendMenuAction(
              mainWindow,
              'View.Named views.Create named view'
            ),
          },
          {
            label: 'Load Named View',
            id: 'View.Named views.Load named view',
            click: sendMenuAction(
              mainWindow,
              'View.Named views.Load named view'
            ),
          },
          {
            label: 'Delete Named View',
            id: 'View.Named views.Delete named view',
            click: sendMenuAction(
              mainWindow,
              'View.Named views.Delete named view'
            ),
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
            click: sendMenuAction(mainWindow, 'View.Panes.Feature tree'),
          },
          {
            label: 'KCL code',
            id: 'View.Panes.KCL code',
            click: sendMenuAction(mainWindow, 'View.Panes.KCL code'),
          },
          {
            label: 'Project files',
            id: 'View.Panes.Project files',
            click: sendMenuAction(mainWindow, 'View.Panes.Project files'),
          },
          {
            label: 'Variables',
            id: 'View.Panes.Variables',
            click: sendMenuAction(mainWindow, 'View.Panes.Variables'),
          },
          {
            label: 'Logs',
            id: 'View.Panes.Logs',
            click: sendMenuAction(mainWindow, 'View.Panes.Logs'),
          },
          {
            label: 'Zookeeper',
            id: 'View.Panes.Zookeeper',
            click: sendMenuAction(mainWindow, 'View.Panes.Zookeeper'),
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
