import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { AutoUpdateDownloadStatus } from '@src/components/StatusBar/AutoUpdateDownloadStatus'

describe('AutoUpdateDownloadStatus', () => {
  test('renders progress text and bar width from download progress', () => {
    render(
      <AutoUpdateDownloadStatus
        progress={{
          bytesPerSecond: 1_000_000,
          delta: 10_000,
          percent: 42.4,
          total: 100_000_000,
          transferred: 42_400_000,
        }}
      />
    )

    expect(screen.getByTestId('auto-update-download-status')).toHaveTextContent(
      'Update 42%'
    )
    expect(screen.getByTestId('auto-update-download-progress-bar')).toHaveStyle(
      'width: 42%'
    )
  })

  test('clamps percent above 100', () => {
    render(
      <AutoUpdateDownloadStatus
        progress={{
          bytesPerSecond: 1_000_000,
          delta: 10_000,
          percent: 101.2,
          total: 100_000_000,
          transferred: 100_000_000,
        }}
      />
    )

    expect(screen.getByTestId('auto-update-download-progress-bar')).toHaveStyle(
      'width: 100%'
    )
  })
})
