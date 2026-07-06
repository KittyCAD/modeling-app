import { sendMenuAction } from '@src/menu/channels'
import type { ZooMenuItemConstructorOptions } from '@src/menu/roles'
import type { BrowserWindow } from 'electron'

export const modelingDesignRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
  return {
    label: 'Design',
    submenu: [
      {
        label: 'Start Sketch',
        id: 'Design.Start sketch',
        click: sendMenuAction(mainWindow, 'Design.Start sketch'),
      },
      { type: 'separator' },
      {
        label: 'Create an Offset Plane',
        id: 'Design.Create an offset plane',
        click: sendMenuAction(mainWindow, 'Design.Create an offset plane'),
      },
      {
        label: 'Create a Helix',
        id: 'Design.Create a helix',
        click: sendMenuAction(mainWindow, 'Design.Create a helix'),
      },
      {
        label: 'Create a Parameter',
        id: 'Design.Create a parameter',
        click: sendMenuAction(mainWindow, 'Design.Create a parameter'),
      },
      { type: 'separator' },
      {
        label: 'Create an Additive Feature',
        id: 'Design.Create an additive feature',
        submenu: [
          {
            label: 'Extrude',
            id: 'Design.Create an additive feature.Extrude',
            click: sendMenuAction(
              mainWindow,
              'Design.Create an additive feature.Extrude'
            ),
          },
          {
            label: 'Revolve',
            id: 'Design.Create an additive feature.Revolve',
            click: sendMenuAction(
              mainWindow,
              'Design.Create an additive feature.Revolve'
            ),
          },
          {
            label: 'Sweep',
            id: 'Design.Create an additive feature.Sweep',
            click: sendMenuAction(
              mainWindow,
              'Design.Create an additive feature.Sweep'
            ),
          },
          {
            label: 'Loft',
            id: 'Design.Create an additive feature.Loft',
            click: sendMenuAction(
              mainWindow,
              'Design.Create an additive feature.Loft'
            ),
          },
        ],
      },
      {
        label: 'Apply Modification Feature',
        id: 'Design.Apply modification feature',
        submenu: [
          {
            label: 'Fillet',
            id: 'Design.Apply modification feature.Fillet',
            click: sendMenuAction(
              mainWindow,
              'Design.Apply modification feature.Fillet'
            ),
          },
          {
            label: 'Chamfer',
            id: 'Design.Apply modification feature.Chamfer',
            click: sendMenuAction(
              mainWindow,
              'Design.Apply modification feature.Chamfer'
            ),
          },
          {
            label: 'Shell',
            id: 'Design.Apply modification feature.Shell',
            click: sendMenuAction(
              mainWindow,
              'Design.Apply modification feature.Shell'
            ),
          },
        ],
      },
      { type: 'separator' },
      {
        label: 'Insert from Project File',
        id: 'Design.Insert from project file',
        click: sendMenuAction(mainWindow, 'Design.Insert from project file'),
      },
    ],
  }
}
