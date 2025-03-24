
import { BrowserWindow } from 'electron'
import { typeSafeWebContentsSend } from './channels'
import { ZooMenuItemConstructorOptions } from './roles'

export const modelingDesignRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
  return {
    label: 'Design',
    submenu: [
      {
        label: 'Start sketch',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Design.Start sketch',
          })
        },
      },
      {type:'separator'},
      {
        label: 'Create an offset plane',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Design.Create an offset plane',
          })
        },
      },
      {
        label: 'Create a helix',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Design.Create a helix',
          })
        },
      },
      {
        label: 'Create a parameter',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Design.Create a parameter',
          })
        },
      },
      {type: 'separator'},
      {
        label: 'Create an additive feature',
        submenu: [
          {
            label: 'Extrude',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'Design.Create an additive feature.Extrude',
              })
            },
          },
          {
            label: 'Revolve',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'Design.Create an additive feature.Revolve',
              })
            },
          },
          {
            label: 'Sweep',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'Design.Create an additive feature.Sweep',
              })
            },
          },
          {
            label: 'Loft',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'Design.Create an additive feature.Loft',
              })
            },
          },
        ]
      },
      {
        label: 'Apply modification feature',
        submenu: [
          {
            label: 'Fillet',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'Design.Apply modification feature.Fillet',
              })
            },
          },
          {
            label: 'Chamfer',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'Design.Apply modification feature.Chamfer',
              })
            },
          },
          {
            label: 'Shell',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'Design.Apply modification feature.Shell',
              })
            },
          },
        ]
      },
      {type:'separator'},
      {
        label: 'Create with Zoo Text-To-CAD',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Design.Create with Zoo Text-To-CAD',
          })
        },
      },
      {
        label: 'Modify with Zoo Text-To-CAD',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Design.Modify with Zoo Text-To-CAD',
          })
        },
      },
    ]
  }
}
