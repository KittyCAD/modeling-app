import { DownloadDesktopApp } from '@src/components/DownloadDesktopApp'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { APP_DOWNLOAD_PATH } from '@src/routes/utils'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('DownloadDesktopApp', () => {
  it('links to the desktop app download page', () => {
    render(<DownloadDesktopApp />)

    expect(
      screen.getByRole('link', { name: 'Download desktop app' })
    ).toHaveAttribute('href', withSiteBaseURL(`/${APP_DOWNLOAD_PATH}`))
  })
})
