import type { BrowserWindow } from 'electron'
import { shell } from 'electron'

import { reportRejection } from '@src/lib/trap'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
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
        label: 'Show All Commands',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Help.Command Palette...',
          })
        },
      },
      {
        label: 'KCL Code Samples',
        id: 'Help.KCL code samples',
        click: () => {
          shell
            .openExternal(withSiteBaseURL('/docs/kcl-samples'))
            .catch(reportRejection)
        },
      },
      {
        label: 'KCL Docs',
        click: () => {
          shell
            .openExternal(withSiteBaseURL('/docs/kcl'))
            .catch(reportRejection)
        },
      },
      {
        label: 'Get Started with Zookeeper',
        click: () => {
          shell
            .openExternal('https://text-to-cad.zoo.dev/dashboard')
            .catch(reportRejection)
        },
      },
      { type: 'separator' },
      {
        label: 'Ask the Community Discord',
        click: () => {
          shell
            .openExternal('https://discord.gg/JQEpHR7Nt2')
            .catch(reportRejection)
        },
      },
      {
        label: 'Ask the Community Discourse',
        click: () => {
          shell
            .openExternal('https://community.zoo.dev/')
            .catch(reportRejection)
        },
      },
      { type: 'separator' },
      {
        label: 'Report a Bug',
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
        label: 'Request a Feature',
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
        label: 'Replay Onboarding Tutorial',
        click: () => {
          typeSafeWebContentsSend(mainWindow, 'menu-action-clicked', {
            menuLabel: 'Help.Replay onboarding tutorial',
          })
        },
      },
      { type: 'separator' },
      {
        label: 'Show Release Notes',
        click: () => {
          shell
            .openExternal('https://github.com/KittyCAD/modeling-app/releases')
            .catch(reportRejection)
        },
      },
      {
        label: 'Check for Updates',
        click: () => {
          getAutoUpdater().checkForUpdates().catch(reportRejection)
        },
      },
      { type: 'separator' },
      {
        label: 'Manage Account',
        click: () => {
          shell.openExternal(withSiteBaseURL('/account')).catch(reportRejection)
        },
      },
    ],
  }
}
