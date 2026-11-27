import { signal } from '@preact/signals-core'
import { describeCloudLibrary } from '@src/lib/cloudProjects/libraryPresentation'
import { isDesktop } from '@src/lib/isDesktop'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import type { HomeProjectActionsService } from '@src/registry/contracts/homeProjects'
import { HomeHeader } from '@src/routes/HomeHeader'
import { ProjectLibraryPreviewRow } from '@src/routes/HomeProjectCards'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/isDesktop', () => ({ isDesktop: vi.fn(() => false) }))

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
  onRefresh,
  isRefreshing = false,
}: {
  library?: ProjectLibrary
  libraryDetails?: ReactNode
  showLibraryBackLink?: boolean
  onRefresh?: () => void
  isRefreshing?: boolean
} = {}) {
  render(
    <MemoryRouter>
      <HomeHeader
        title="Personal Cloud"
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
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

describe('HomeHeader', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(isDesktop).mockReset()
  })

  it('allows another refresh after five seconds without showing it as busy during cooldown', async () => {
    vi.useFakeTimers()
    const onRefresh = vi.fn()
    renderHomeHeader({ onRefresh })
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
    renderHomeHeader({ onRefresh: vi.fn(), isRefreshing: true })
    await act(() => vi.advanceTimersByTime(5_000))
    expect(
      screen.getByRole('button', { name: 'Refresh projects' })
    ).toBeDisabled()
  })

  it.each([false, true])(
    'shows the refresh button with loading=%s',
    (isRefreshing) => {
      const onRefresh = vi.fn()
      renderHomeHeader({ onRefresh, isRefreshing })
      const button = screen.getByRole('button', { name: 'Refresh projects' })
      expect(button).toHaveAttribute('aria-busy', String(isRefreshing))
      if (isRefreshing) expect(button).toBeDisabled()
      else expect(button).toBeEnabled()
      fireEvent.click(button)
      expect(onRefresh).toHaveBeenCalledTimes(isRefreshing ? 0 : 1)
    }
  )
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
    vi.mocked(isDesktop).mockReturnValue(true)
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

  it('shows the directory path on web without a settings link', () => {
    renderHomeHeader({
      library: {
        id: 'local-library',
        title: 'Work',
        path: '/projects/work',
        type: 'directory',
      },
    })

    expect(screen.getByText('Folder: /projects/work')).toBeVisible()
    expect(
      screen.queryByRole('link', { name: '/projects/work' })
    ).not.toBeInTheDocument()
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
