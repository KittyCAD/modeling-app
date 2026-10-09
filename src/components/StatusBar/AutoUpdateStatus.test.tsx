import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/isDesktop', () => ({
  isDesktop: vi.fn(),
}))

vi.mock('@src/routes/utils', () => ({
  APP_VERSION: '1.0.0',
  getReleaseUrl: () =>
    'https://github.com/KittyCAD/modeling-app/releases/tag/v1.0.0',
}))

import { AutoUpdateStatus } from '@src/components/StatusBar/AutoUpdateStatus'
import {
  clearAutoUpdateDownloadProgress,
  clearAutoUpdateReady,
  setAutoUpdateDownloadProgress,
  setAutoUpdateReady,
} from '@src/lib/autoUpdate'
import { isDesktop } from '@src/lib/isDesktop'

describe('AutoUpdateStatus', () => {
  beforeEach(() => {
    clearAutoUpdateDownloadProgress()
    clearAutoUpdateReady()
    vi.mocked(isDesktop).mockReturnValue(true)
  })

  afterEach(() => {
    clearAutoUpdateDownloadProgress()
    clearAutoUpdateReady()
    vi.unstubAllGlobals()
  })

  it.each([false, true])(
    'reacts to download and restart with inline=%s',
    async (inline) => {
      const appRestart = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('electron', { appRestart })
      render(<AutoUpdateStatus inline={inline} />)
      if (inline) {
        expect(screen.queryByRole('group', { name: 'App update' })).toBeNull()
      } else {
        expect(screen.getByRole('link', { name: 'v1.0.0' })).toBeVisible()
      }
      expect(screen.queryByTestId('auto-update-download-status')).toBeNull()
      expect(
        screen.queryByRole('button', { name: /Restart to update/ })
      ).toBeNull()

      act(() => {
        setAutoUpdateDownloadProgress({
          bytesPerSecond: 1_000_000,
          delta: 10_000,
          percent: 73,
          total: 100_000_000,
          transferred: 73_000_000,
        })
      })
      expect(await screen.findByText('Update 73%')).toBeVisible()

      act(() => {
        setAutoUpdateReady({ version: '1.2.3' })
      })
      const restart = await screen.findByRole('button', {
        name: 'Restart to update to v1.2.3',
      })
      expect(screen.queryByText('Update 73%')).toBeNull()
      fireEvent.click(restart)
      expect(appRestart).toHaveBeenCalledOnce()
    }
  )

  it('hides desktop updates in the web app', () => {
    vi.mocked(isDesktop).mockReturnValue(false)
    setAutoUpdateReady({ version: '1.2.3' })
    render(<AutoUpdateStatus />)
    expect(screen.queryByRole('group', { name: 'App update' })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
