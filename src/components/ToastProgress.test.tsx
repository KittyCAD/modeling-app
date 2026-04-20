import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { ToastProgress } from '@src/components/ToastProgress'

describe('ToastProgress', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('renders explicit progress values', () => {
    render(
      <ToastProgress
        title="Downloading app update..."
        subtitle="42% complete"
        progressPercent={41.5}
        showSpinner={false}
      />
    )

    const progressBar = screen.getByTestId('toast-progress-bar')
    const progressLabel = screen.getByTestId('toast-progress-label')

    expect(progressBar).toHaveStyle('width: 41.5%')
    expect(progressLabel).toHaveTextContent('42%')
  })

  test('tracks progress from duration when explicit progress is not provided', () => {
    vi.useFakeTimers()

    render(
      <ToastProgress
        title="Copying files..."
        durationMs={1_000}
        showSpinner={false}
      />
    )

    const progressBar = screen.getByTestId('toast-progress-bar')
    const progressLabel = screen.getByTestId('toast-progress-label')

    expect(progressBar).toHaveStyle('width: 0%')
    expect(progressLabel).toHaveTextContent('0%')

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(progressBar).toHaveStyle('width: 50%')
    expect(progressLabel).toHaveTextContent('50%')
  })
})
