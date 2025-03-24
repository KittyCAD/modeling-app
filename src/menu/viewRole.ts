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
      { type: 'separator'},
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
      { type: 'separator'},
      {
        label: 'Standard views',
        submenu: [
          {
            label: 'Right view',
            click: () => {
            typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
              menuLabel: 'View.Standard views.Right view',
            })
            }
          },
          {
            label: 'Back view',
            click: () => {
            typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
              menuLabel: 'View.Back view',
            })
            }
          },

          {
            label: 'Top view',
            click: () => {
            typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
              menuLabel: 'View.Top view',
            })
            }
          },

          {
            label: 'Left view',
            click: () => {
            typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
              menuLabel: 'View.Left view',
            })
            }
          },

          {
            label: 'Front view',
            click: () => {
            typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
              menuLabel: 'View.Front view',
            })
            }
          },

          {
            label: 'Bottom view',
            click: () => {
            typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
              menuLabel: 'View.Bottom view',
            })
            }
          },
          { type: 'separator'},
          {
            label: 'Reset view',
            click: () => {
            typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
              menuLabel: 'View.Reset view',
            })
            }
          },

          {
            label: 'Center view on selection',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Center view on selection',
              })
            }
          },
          {
            label: 'Refresh',
            click: () => {
            typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
              menuLabel: 'View.Refresh',
            })
            }
          },
        ]
      },
      {
        label: 'Named views',
        submenu: [
          {
            label: 'Create named view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Create named view',
              })
            }
          },

          {
            label: 'List named views',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.List named views',
              })
            }
          },

          {
            label: 'Delete named view',
            click: () => {
              typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
                menuLabel: 'View.Delete named view',
              })
            }
          },
        ]
      },
      {type:'separator'},
      {
        label:'Panes',
        submenu : [
          {
            label: 'Feature tree',
            click: () => {
            typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
              menuLabel: 'View.Feature true',
            })
            }
          },
          {
            label: 'KCL code',
            click: () => {
            typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
              menuLabel: 'View.KCL code',
            })
            }
          },
          {
            label: 'Project files',
            click: () => {
            typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
              menuLabel: 'View.Project files',
            })
            }
          },
          {
            label: 'Variables',
            click: () => {
            typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
              menuLabel: 'View.Variables',
            })
            }
          },
          {
            label: 'Logs',
            click: () => {
            typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
              menuLabel: 'View.Logs',
            })
            }
          },
          {
            label: 'Debug',
            click: () => {
            typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
              menuLabel: 'View.Debug',
            })
            }
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
