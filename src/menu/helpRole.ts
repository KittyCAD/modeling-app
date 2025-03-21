import { shell, BrowserWindow } from 'electron'
import { ZooMenuItemConstructorOptions } from './roles'
import { reportRejection } from 'lib/trap'
import { typeSafeWebContentsSend } from './channels'

export const helpRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
  return {
    label: 'Help',
    submenu: [
      {
        label: 'Show all commands',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Help.Command Palette...',
          })
        },
      },
      {
        label: 'KCL code samples',
        click: () => {
          shell
            .openExternal('https://zoo.dev/docs/kcl-samples')
            .catch(reportRejection)
        },
      },
      {
        label: 'KCL docs',
        click: () => {
          shell.openExternal('https://zoo.dev/docs/kcl').catch(reportRejection)
        },
      },
      {
        label: 'Get started with Text-to-CAD',
        click: () => {
          shell
            .openExternal('https://text-to-cad.zoo.dev/dashboard')
            .catch(reportRejection)
        },
      },
      { type: 'separator' },
      {
        label: 'Ask the community discord',
        click: () => {
          shell
            .openExternal('https://discord.gg/JQEpHR7Nt2')
            .catch(reportRejection)
        },
      },
      {
        label: 'Ask the community discourse',
        click: () => {
          shell
            .openExternal('https://community.zoo.dev/')
            .catch(reportRejection)
        },
      },
      { type: 'separator' },
      {
        label: 'Report a bug',
        click: () => {
          shell
            .openExternal(
              'https://github.com/KittyCAD/modeling-app/issues/new/choose'
            )
            .catch(reportRejection)
        },
      },
      {
        label: 'Request a feature',
        click: () => {
          shell
            .openExternal(
              'https://github.com/KittyCAD/modeling-app/discussions'
            )
            .catch(reportRejection)
        },
      },
      { type: 'separator' },
      {
        label: 'Reset onboarding',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Help.Reset onboarding',
          })
        },
      },
      { type: 'separator' },
      { role: 'toggleDevTools' },
      { role: 'reload' },
      { role: 'forceReload' },
      { type: 'separator' },
      {
        label: 'Show release notes',
        click: () => {
          shell
            .openExternal('https://github.com/KittyCAD/modeling-app/releases')
            .catch(reportRejection)
        },
      },
      { type: 'separator' },
      {
        label: 'Manage account',
        click: () => {
          shell.openExternal('https://zoo.dev/account').catch(reportRejection)
        },
      },
    ],
  }
}
