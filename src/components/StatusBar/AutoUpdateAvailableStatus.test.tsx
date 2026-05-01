import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { AutoUpdateAvailableStatus } from '@src/components/StatusBar/AutoUpdateAvailableStatus'

describe('AutoUpdateAvailableStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('calls onDownload when clicking the update button', () => {
    const onDownload = vi.fn()

    render(
      <AutoUpdateAvailableStatus
        onDownload={onDownload}
        update={{ version: '1.2.3' }}
      />
    )

    fireEvent.click(screen.getByTestId('auto-update-available-status'))
    expect(onDownload).toHaveBeenCalledTimes(1)
  })
})
