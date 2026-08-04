import { DownloadDesktopApp } from '@src/components/StatusBar/DownloadDesktopApp'
import { defaultGlobalStatusBarItems } from '@src/components/StatusBar/defaultStatusBarItems'
import { isDesktop } from '@src/lib/isDesktop'
import { getReleaseUrl } from '@src/routes/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/isDesktop', () => ({
  isDesktop: vi.fn(),
}))
vi.mock('@src/components/HelpMenu', () => ({
  HelpMenu: vi.fn(),
}))
vi.mock('@src/components/StatusBar/AutoUpdateDownloadStatus', () => ({
  AutoUpdateDownloadStatus: vi.fn(),
}))
vi.mock('@src/components/StatusBar/AutoUpdateReadyStatus', () => ({
  AutoUpdateReadyStatus: vi.fn(),
}))
vi.mock('@src/components/StatusBar/DownloadDesktopApp', () => ({
  DownloadDesktopApp: vi.fn(),
}))
vi.mock('@src/components/environment/Environment', () => ({
  EnvironmentChip: vi.fn(),
  EnvironmentDescription: vi.fn(),
}))

const mockedIsDesktop = vi.mocked(isDesktop)

describe('defaultGlobalStatusBarItems', () => {
  beforeEach(() => {
    mockedIsDesktop.mockReset()
  })

  it('shows the app version in the desktop status bar', () => {
    const appVersion = '1.2.3'
    mockedIsDesktop.mockReturnValue(true)

    expect(
      defaultGlobalStatusBarItems({
        appVersion,
        hasCloudSyncFeature: false,
      })[0]
    ).toEqual({
      id: 'version',
      element: 'externalLink',
      label: `v${appVersion}`,
      href: getReleaseUrl(appVersion),
      toolTip: {
        children: 'View this version on GitHub',
      },
    })
  })

  it('shows the desktop app download in the web status bar without cloud sync', () => {
    mockedIsDesktop.mockReturnValue(false)

    expect(
      defaultGlobalStatusBarItems({ hasCloudSyncFeature: false })[0]
    ).toEqual({
      id: 'download-desktop-app',
      'data-testid': 'download-desktop-app',
      component: DownloadDesktopApp,
    })
  })

  it('shows no version or download item in web with cloud sync', () => {
    mockedIsDesktop.mockReturnValue(false)

    const items = defaultGlobalStatusBarItems({
      appVersion: 'fe581ff',
      hasCloudSyncFeature: true,
    })

    expect(items.some(({ id }) => id === 'version')).toBe(false)
    expect(items.some(({ id }) => id === 'download-desktop-app')).toBe(false)
  })
})
