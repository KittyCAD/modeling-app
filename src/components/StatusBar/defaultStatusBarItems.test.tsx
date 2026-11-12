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

  it('shows no version or download item in the web status bar', () => {
    mockedIsDesktop.mockReturnValue(false)

    const items = defaultGlobalStatusBarItems({
      appVersion: 'fe581ff',
    })

    expect(items.some(({ id }) => id === 'version')).toBe(false)
    expect(items.some(({ id }) => id === 'download-desktop-app')).toBe(false)
  })
})
