import { shell, BrowserWindow } from 'electron'
import { ZooMenuItemConstructorOptions } from './roles'

export const helpRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
  return {
    label: 'Help',
    submenu: [
      {
        label: 'Report a bug',
        click: async () => {
          await shell.openExternal(
            'https://github.com/KittyCAD/modeling-app/issues/new/choose'
          )
        },
      },
      {
        label: 'Request a feature',
        click: async () => {
          await shell.openExternal(
            'https://github.com/KittyCAD/modeling-app/discussions'
          )
        },
      },
      { type: 'separator' },
      {
        label: 'Ask the community discord',
        click: async () => {
          await shell.openExternal('https://discord.gg/JQEpHR7Nt2')
        },
      },
      {
        label: 'Ask the community discourse',
        click: async () => {
          await shell.openExternal('https://community.zoo.dev/')
        },
      },
      { type: 'separator' },
      {
        label: 'KCL code samples',
        click: async () => {
          await shell.openExternal('https://zoo.dev/docs/kcl-samples')
        },
      },
      {
        label: 'KCL docs',
        click: async () => {
          await shell.openExternal('https://zoo.dev/docs/kcl')
        },
      },
      { type: 'separator' },
      {
        label: 'Reset onboarding',
        click: async () => {
          mainWindow.webContents.send('Help.Reset onboarding')
        },
      },
      { type: 'separator' },
      {
        label: 'Release notes',
        click: async () => {
          await shell.openExternal(
            'https://github.com/KittyCAD/modeling-app/releases'
          )
        },
      },
    ],
  }
}
