import { signal } from '@preact/signals-core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import { AppToaster } from '@src/components/AppToaster'
import { ProjectArchiveLimitToast } from '@src/components/ProjectArchiveLimitToast'
import { ProjectArchiveLimitError } from '@src/lib/cloudProjects/runtime/archiveContents'

afterEach(() => {
  act(() => toast.remove())
  vi.useRealTimers()
})

it.each(['bytes', 'entries'] as const)(
  'keeps the %s limit toast visible until Dismiss is clicked',
  (limit) => {
    vi.useFakeTimers()
    const archiveLimitFailure = signal<ProjectArchiveLimitError | undefined>()
    const dismissArchiveLimitFailure = vi.fn(() => {
      archiveLimitFailure.value = undefined
    })
    const cloud = { archiveLimitFailure, dismissArchiveLimitFailure }
    render(
      <>
        <AppToaster />
        <ProjectArchiveLimitToast cloud={cloud} />
      </>
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    act(() => {
      archiveLimitFailure.value = new ProjectArchiveLimitError(limit)
    })
    expect(
      screen.getByRole('heading', {
        name: `Project exceeds ${limit === 'bytes' ? '1 GiB' : '10,000 entries'}`,
      })
    ).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(
      limit === 'bytes' ? '1 GiB' : '10,000'
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Reduce')
    expect(
      screen.getByRole('link', { name: 'Contact support' })
    ).toHaveAttribute('href', 'https://community.zoo.dev/')
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByRole('alert')).toBeVisible()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('alert')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(dismissArchiveLimitFailure).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  }
)

it('removes the toast when Home unmounts and restores the undismissed notice on return', () => {
  const cloud = {
    archiveLimitFailure: signal<ProjectArchiveLimitError | undefined>(
      new ProjectArchiveLimitError('bytes')
    ),
    dismissArchiveLimitFailure: vi.fn(),
  }
  render(<AppToaster />)
  const view = render(<ProjectArchiveLimitToast cloud={cloud} />)
  expect(screen.getByRole('alert')).toBeVisible()
  view.unmount()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  render(<ProjectArchiveLimitToast cloud={cloud} />)
  expect(screen.getByRole('alert')).toBeVisible()
  expect(cloud.dismissArchiveLimitFailure).not.toHaveBeenCalled()
})
