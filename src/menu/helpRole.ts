import type { BrowserWindow } from 'electron'
import { shell } from 'electron'

import { reportRejection } from '@src/lib/trap'
import { typeSafeWebContentsSend } from '@src/menu/channels'
import type { ZooMenuItemConstructorOptions } from '@src/menu/roles'
import { getAutoUpdater } from '@src/updater'

export const helpRole = (
  mainWindow: BrowserWindow
): ZooMenuItemConstructorOptions => {
  return {
    label: 'Help',
    submenu: [
      {
        id: 'Help.Show all commands',
        label: 'Show all commands',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Help.Command Palette...',
          })
        },
      },
      {
        label: 'KCL code samples',
        id: 'Help.KCL code samples',
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
        id: 'Help.Report a bug',
        click: () => {
          shell
            .openExternal(
              'https://github.com/KittyCAD/modeling-app/issues/new?template=bug_report.yml'
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
        id: 'Help.Replay onboarding tutorial',
        label: 'Replay onboarding tutorial',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Help.Replay onboarding tutorial',
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
      {
        label: 'Check for updates',
        click: () => {
          getAutoUpdater().checkForUpdates().catch(reportRejection)
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
