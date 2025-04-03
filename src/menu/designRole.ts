import { typeSafeWebContentsSend } from '@src/menu/channels'
import type { ZooMenuItemConstructorOptions } from '@src/menu/roles'
import type { BrowserWindow } from 'electron'

export const modelingDesignRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
  return {
    label: 'Design',
    submenu: [
      {
        label: 'Start sketch',
        id: 'Design.Start sketch',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Design.Start sketch',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Create an offset plane',
        id: 'Design.Create an offset plane',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Design.Create an offset plane',
          })
        },
      },
      {
        label: 'Create a helix',
        id: 'Design.Create a helix',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Design.Create a helix',
          })
        },
      },
      {
        label: 'Create a parameter',
        id:'Design.Create a parameter',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Design.Create a parameter',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Create an additive feature',
        id: 'Design.Create an additive feature',
        submenu: [
          {
            label: 'Extrude',
            id: 'Design.Create an additive feature.Extrude',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'Design.Create an additive feature.Extrude',
              })
            },
          },
          {
            label: 'Revolve',
            id: 'Design.Create an additive feature.Revolve',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'Design.Create an additive feature.Revolve',
              })
            },
          },
          {
            label: 'Sweep',
            id: 'Design.Create an additive feature.Sweep',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'Design.Create an additive feature.Sweep',
              })
            },
          },
          {
            label: 'Loft',
            id: 'Design.Create an additive feature.Loft',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'Design.Create an additive feature.Loft',
              })
            },
          },
        ],
      },
      {
        label: 'Apply modification feature',
        id: 'Design.Apply modification feature',
        submenu: [
          {
            label: 'Fillet',
            id: 'Design.Apply modification feature.Fillet',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'Design.Apply modification feature.Fillet',
              })
            },
          },
          {
            label: 'Chamfer',
            id: 'Design.Apply modification feature.Chamfer',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'Design.Apply modification feature.Chamfer',
              })
            },
          },
          {
            label: 'Shell',
            id: 'Design.Apply modification feature.Shell',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'Design.Apply modification feature.Shell',
              })
            },
          },
        ],
      },
      { type: 'separator' },
      {
        label: 'Create with Zoo Text-To-CAD',
        id: 'Design.Create with Zoo Text-To-CAD',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Design.Create with Zoo Text-To-CAD',
          })
        },
      },
      {
        label: 'Modify with Zoo Text-To-CAD',
        id: 'Design.Modify with Zoo Text-To-CAD',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Design.Modify with Zoo Text-To-CAD',
          })
        },
      },
    ],
  }
}
