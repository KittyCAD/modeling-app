import { signal } from '@preact/signals-core'
import { describeCloudLibrary } from '@src/lib/cloudProjects/libraryPresentation'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import type { HomeProjectActionsService } from '@src/registry/contracts/homeProjects'
import { HomeHeader, HomeRefreshButton } from '@src/routes/HomeHeader'
import { ProjectLibraryPreviewRow } from '@src/routes/HomeProjectCards'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cloudLibrary = {
  id: 'cloud-personal',
  title: 'Personal Cloud',
  path: '/documents/Zoo Projects',
  type: 'cloud',
  presentation: describeCloudLibrary({}),
} satisfies ProjectLibrary

const projectActions = {
  pendingActions: signal(new Map()),
  watchRemoteThumbnail: vi.fn(() => vi.fn()),
  canOpen: vi.fn(() => false),
  canDuplicate: vi.fn(() => false),
  canRename: vi.fn(() => false),
  canDelete: vi.fn(() => false),
  canDuplicateToLibrary: vi.fn(() => false),
  canReviewDuplicateRealizations: vi.fn(() => false),
  canSeparateProjectCopies: vi.fn(() => false),
  open: vi.fn(async () => undefined),
  duplicate: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  delete: vi.fn(async () => undefined),
  getDuplicateToLibraryTargets: vi.fn(() => []),
  duplicateToLibrary: vi.fn(async () => undefined),
  deleteDuplicateRealizations: vi.fn(async () => undefined),
  separateProjectCopies: vi.fn(async () => undefined),
} satisfies HomeProjectActionsService

function renderHomeHeader({
  library = cloudLibrary,
  libraryDetails,
  showLibraryBackLink = false,
}: {
  library?: ProjectLibrary
  libraryDetails?: ReactNode
  showLibraryBackLink?: boolean
} = {}) {
  render(
    <MemoryRouter>
      <HomeHeader
        title="Personal Cloud"
        library={library}
        setQuery={vi.fn()}
        sort="modified:desc"
        setSearchParams={vi.fn()}
        readWriteProjectDir={{ value: true, error: undefined }}
        libraryDetails={libraryDetails}
        showLibraryBackLink={showLibraryBackLink}
      />
    </MemoryRouter>
  )
}

function renderProjectLibraryPreviewRow(library: ProjectLibrary) {
  render(
    <MemoryRouter>
      <ProjectLibraryPreviewRow
        library={library}
        projects={[]}
        query=""
        projectStatuses={new Map()}
        projectActions={projectActions}
        fileOperations={{
          stat: vi.fn(),
          readFile: vi.fn(),
        }}
        showCloudSyncUi={true}
        onDuplicateToLibrary={vi.fn()}
      />
    </MemoryRouter>
  )
}

describe('HomeRefreshButton', () => {
  afterEach(() => vi.useRealTimers())

  it('allows another refresh after five seconds without showing it as busy during cooldown', async () => {
    vi.useFakeTimers()
    const onRefresh = vi.fn()
    render(<HomeRefreshButton onRefresh={onRefresh} isRefreshing={false} />)
    const button = screen.getByRole('button', { name: 'Refresh projects' })
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'false')
    await act(() => vi.advanceTimersByTime(4_999))
    fireEvent.click(button)
    expect(onRefresh).toHaveBeenCalledOnce()
    await act(() => vi.advanceTimersByTime(1))
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('keeps refresh disabled after the cooldown while a request is still running', async () => {
    vi.useFakeTimers()
    render(<HomeRefreshButton onRefresh={vi.fn()} isRefreshing />)
    await act(() => vi.advanceTimersByTime(5_000))
    expect(
      screen.getByRole('button', { name: 'Refresh projects' })
    ).toBeDisabled()
  })

  it.each([false, true])(
    'shows the refresh button with loading=%s',
    (isRefreshing) => {
      const onRefresh = vi.fn()
      render(
        <HomeRefreshButton onRefresh={onRefresh} isRefreshing={isRefreshing} />
      )
      const button = screen.getByRole('button', { name: 'Refresh projects' })
      expect(button).toHaveAttribute('aria-busy', String(isRefreshing))
      if (isRefreshing) expect(button).toBeDisabled()
      else expect(button).toBeEnabled()
      fireEvent.click(button)
      expect(onRefresh).toHaveBeenCalledTimes(isRefreshing ? 0 : 1)
    }
  )
})

describe('HomeHeader', () => {
  it('renders contributed library details with the description', () => {
    renderHomeHeader({
      libraryDetails: <span>Additional library details</span>,
    })

    expect(
      screen.getByText(/Projects in this library are saved to your Zoo account/)
    ).toHaveTextContent('Additional library details')
  })

  it('keeps non-directory locations out of the Settings link', () => {
    renderHomeHeader({ library: { ...cloudLibrary, type: 'external' } })

    expect(
      screen.getByText(/Projects in this library are saved to your Zoo account/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Storage type and model-training controls depend on your plan/
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('project-directory-settings-link')
    ).not.toBeInTheDocument()
  })

  it('links a directory library to Local Libraries and back to Home', () => {
    renderHomeHeader({
      library: {
        id: 'local-library',
        title: 'Work',
        path: '/projects/work',
        type: 'directory',
      },
      showLibraryBackLink: true,
    })

    expect(
      screen.getByRole('link', { name: '/projects/work' })
    ).toHaveAttribute('href', '/home/settings?tab=user#libraries')
    const backLink = screen.getByRole('link', { name: 'All libraries' })
    expect(backLink).toHaveAttribute('href', '/home')
    expect(backLink.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')

    const detailsIcon = screen.getByTestId('project-library-details-icon')
    expect(detailsIcon.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true'
    )
  })
})

describe('ProjectLibraryPreviewRow', () => {
  it('shows only descriptive text in the cloud library summary and tooltip', () => {
    renderProjectLibraryPreviewRow(cloudLibrary)

    const libraryLink = screen.getByTestId('project-library-link')
    const summaryDescription = screen.getByTestId(
      'project-library-summary-description'
    )
    expect(libraryLink).toHaveTextContent('Personal Cloud')
    expect(summaryDescription.textContent).toBe(
      cloudLibrary.presentation.summaryDescription
    )
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe(
      cloudLibrary.presentation.detailsDescription
    )
  })
})
