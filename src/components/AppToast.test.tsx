import { act, cleanup, render, screen } from '@testing-library/react'
import toast from 'react-hot-toast'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppToaster } from '@src/components/AppToaster'

describe('AppToast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    act(() => toast.remove())
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('keeps loading feedback and the success display lifetime', () => {
    render(<AppToaster />)
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
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('removes dismissed content immediately without waiting for store cleanup', () => {
    render(<AppToaster />)
    let id = ''
    act(() => {
      id = toast('Reloaded', { icon: 'Folder' })
    })
    const message = screen.getByText('Reloaded')
    expect(message).toBeVisible()
    expect(screen.getByText('Folder')).toBeVisible()
    act(() => toast.dismiss(id))
    expect(message).not.toBeInTheDocument()
    expect(screen.queryByText('Folder')).not.toBeInTheDocument()
    act(() => {
      vi.runOnlyPendingTimers()
    })
    expect(message).not.toBeInTheDocument()
  })
})
