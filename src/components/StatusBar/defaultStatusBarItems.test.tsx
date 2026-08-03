import { DownloadDesktopAppStatusBarItem } from '@src/components/StatusBar/DownloadDesktopAppStatusBarItem'
import { defaultGlobalStatusBarItems } from '@src/components/StatusBar/defaultStatusBarItems'
import { isDesktop } from '@src/lib/isDesktop'
import { APP_VERSION, getReleaseUrl } from '@src/routes/utils'
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
vi.mock('@src/components/StatusBar/DownloadDesktopAppStatusBarItem', () => ({
  DownloadDesktopAppStatusBarItem: vi.fn(),
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

  it.each([
    ['web with cloud sync', false, true],
    ['desktop without cloud sync', true, false],
  ])(
    'shows the app version in the %s status bar',
    (_, desktop, hasCloudSyncFeature) => {
      mockedIsDesktop.mockReturnValue(desktop)

      expect(defaultGlobalStatusBarItems({ hasCloudSyncFeature })[0]).toEqual({
        id: 'version',
        element: 'externalLink',
        label: `v${APP_VERSION}`,
        href: getReleaseUrl(),
        toolTip: {
          children: 'View the release notes on GitHub',
        },
      })
    }
  )

  it('shows the desktop app download in the web status bar without cloud sync', () => {
    mockedIsDesktop.mockReturnValue(false)

    expect(
      defaultGlobalStatusBarItems({ hasCloudSyncFeature: false })[0]
    ).toEqual({
      id: 'download-desktop-app',
      component: DownloadDesktopAppStatusBarItem,
    })
  })
})
