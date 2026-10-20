import { act, cleanup, render, screen } from '@testing-library/react'
import toast, { Toaster } from 'react-hot-toast'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppToast } from '@src/components/AppToast'

function renderToasts() {
  render(
    <Toaster toastOptions={{ success: { duration: 1500 } }}>
      {(toast) => <AppToast toast={toast} />}
    </Toaster>
  )
}

describe('AppToast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    act(() => toast.remove())
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('keeps loading feedback and the success display lifetime', () => {
    renderToasts()
    let id = ''
    act(() => {
      id = toast.loading('Saving')
    })
    expect(screen.getByRole('status')).toHaveTextContent('Saving')
    expect(screen.getByTestId('spinner')).toBeVisible()
    act(() => {
      vi.advanceTimersByTime(10_000)
      toast.success('Saved', { id })
    })
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    act(() => {
      vi.advanceTimersByTime(1499)
    })
    expect(screen.getByText('Saved')).toBeVisible()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByText('Saved')).not.toBeVisible()
  })

  it('hides a dismissed custom-icon toast before removing it from the store', () => {
    renderToasts()
    let id = ''
    act(() => {
      id = toast('Reloaded', { icon: 'Folder' })
    })
    const message = screen.getByText('Reloaded')
    const bar = message.closest('[data-toast-id]')
    expect(message).toBeVisible()
    expect(screen.getByText('Folder')).toBeVisible()
    act(() => toast.dismiss(id))
    expect(bar).toHaveAttribute('data-toast-visible', 'false')
    expect(message).not.toBeVisible()
    act(() => {
      vi.runOnlyPendingTimers()
    })
    expect(message).not.toBeInTheDocument()
  })
})
