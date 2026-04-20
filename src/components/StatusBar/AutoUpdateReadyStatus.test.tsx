import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { AutoUpdateReadyStatus } from '@src/components/StatusBar/AutoUpdateReadyStatus'

describe('AutoUpdateReadyStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('calls onRestart when clicking the update button', () => {
    const onRestart = vi.fn()

    render(
      <AutoUpdateReadyStatus
        onRestart={onRestart}
        update={{ version: '1.2.3' }}
      />
    )

    fireEvent.click(screen.getByTestId('auto-update-ready-status'))
    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  test('renders release notes in a modal using parsed markdown', () => {
    render(
      <AutoUpdateReadyStatus
        onRestart={() => {}}
        update={{
          version: '1.2.3',
          releaseNotes: '## Highlights\n\n- Added **new** behavior',
        }}
      />
    )

    fireEvent.click(screen.getByTestId('auto-update-release-notes-button'))

    expect(
      screen.getByTestId('auto-update-release-notes-modal')
    ).toBeInTheDocument()
    expect(screen.getByText('Release notes for v1.2.3')).toBeInTheDocument()
    expect(screen.getByText('Highlights')).toBeInTheDocument()
    expect(screen.getByText(/Added/)).toBeInTheDocument()
  })

  test('hides release notes button when update has no release notes', () => {
    render(
      <AutoUpdateReadyStatus
        onRestart={() => {}}
        update={{ version: '1.2.3' }}
      />
    )

    expect(
      screen.queryByTestId('auto-update-release-notes-button')
    ).not.toBeInTheDocument()
  })
})
