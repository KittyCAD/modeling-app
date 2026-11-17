import { signal } from '@preact/signals-core'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import {
  FREE_CLOUD_PROJECT_TRAINING_POLICY_URL,
  shouldShowFreeCloudProjectTrainingDisclosure,
} from '@src/lib/projectLibraries/trainingDisclosure'
import type { HomeProjectActionsService } from '@src/registry/contracts/homeProjects'
import { HomeHeader } from '@src/routes/HomeHeader'
import { ProjectLibraryPreviewRow } from '@src/routes/HomeProjectCards'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cloudLibrary = {
  id: 'cloud-personal',
  title: 'Personal Cloud',
  path: '/documents/Zoo Projects',
  type: 'cloud',
} satisfies ProjectLibrary

const projectActions = {
  pendingActions: signal(new Map()),
  watchRemoteThumbnail: vi.fn(() => vi.fn()),
  canOpen: vi.fn(() => false),
  canDuplicate: vi.fn(() => false),
  canRename: vi.fn(() => false),
  canDelete: vi.fn(() => false),
  canCloneToLibrary: vi.fn(() => false),
  canReviewDuplicateRealizations: vi.fn(() => false),
  canSeparateProjectCopies: vi.fn(() => false),
  open: vi.fn(async () => undefined),
  duplicate: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  delete: vi.fn(async () => undefined),
  getCloneToLibraryTargets: vi.fn(() => []),
  cloneToLibrary: vi.fn(async () => undefined),
  deleteDuplicateRealizations: vi.fn(async () => undefined),
  separateProjectCopies: vi.fn(async () => undefined),
} satisfies HomeProjectActionsService

function renderHomeHeader({
  showFreeCloudProjectTrainingDisclosure,
  showLibraryBackLink = false,
  onRefresh,
  isRefreshing = false,
}: {
  showFreeCloudProjectTrainingDisclosure: boolean
  showLibraryBackLink?: boolean
  onRefresh?: () => void
  isRefreshing?: boolean
}) {
  render(
    <MemoryRouter>
      <HomeHeader
        title="Personal Cloud"
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        library={cloudLibrary}
        setQuery={vi.fn()}
        sort="modified:desc"
        setSearchParams={vi.fn()}
        readWriteProjectDir={{ value: true, error: undefined }}
        showFreeCloudProjectTrainingDisclosure={
          showFreeCloudProjectTrainingDisclosure
        }
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
        onCloneToLibrary={vi.fn()}
      />
    </MemoryRouter>
  )
}

describe('HomeHeader', () => {
  afterEach(() => vi.useRealTimers())

  it('allows another refresh after five seconds without showing it as busy during cooldown', async () => {
    vi.useFakeTimers()
    const onRefresh = vi.fn()
    renderHomeHeader({
      showFreeCloudProjectTrainingDisclosure: false,
      onRefresh,
    })
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
    renderHomeHeader({
      showFreeCloudProjectTrainingDisclosure: false,
      onRefresh: vi.fn(),
      isRefreshing: true,
    })
    await act(() => vi.advanceTimersByTime(5_000))
    expect(
      screen.getByRole('button', { name: 'Refresh projects' })
    ).toBeDisabled()
  })

  it.each([false, true])(
    'shows the refresh button with loading=%s',
    (isRefreshing) => {
      const onRefresh = vi.fn()
      renderHomeHeader({
        showFreeCloudProjectTrainingDisclosure: false,
        onRefresh,
        isRefreshing,
      })
      const button = screen.getByRole('button', { name: 'Refresh projects' })
      expect(button).toHaveAttribute('aria-busy', String(isRefreshing))
      if (isRefreshing) expect(button).toBeDisabled()
      else expect(button).toBeEnabled()
      fireEvent.click(button)
      expect(onRefresh).toHaveBeenCalledTimes(isRefreshing ? 0 : 1)
    }
  )

  it('shows the Free cloud-project training disclosure with the policy link', () => {
    renderHomeHeader({
      showFreeCloudProjectTrainingDisclosure:
        shouldShowFreeCloudProjectTrainingDisclosure({
          library: cloudLibrary,
          hasSubscription: false,
        }),
    })

    expect(
      screen.getByText(/Zoo trains on Free user cloud projects/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'See our policy' })
    ).toHaveAttribute('href', FREE_CLOUD_PROJECT_TRAINING_POLICY_URL)
  })

  it('does not show the disclosure when the condition is false', () => {
    renderHomeHeader({
      showFreeCloudProjectTrainingDisclosure: false,
    })

    expect(
      screen.queryByText(/Zoo trains on Free user cloud projects/)
    ).not.toBeInTheDocument()
  })

  it('shows details copy with the linked library path', () => {
    renderHomeHeader({
      showFreeCloudProjectTrainingDisclosure: false,
    })

    expect(
      screen.getByText(/Projects in this library are saved to your Zoo account/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Storage type and model-training controls depend on your plan/
      )
    ).toBeInTheDocument()
    expect(screen.getByText(/Technical source:/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'zoo://personal' })
    ).toHaveAttribute('href', '/home/settings?tab=user#libraries')
  })

  it('shows the selected library type icon and caret back link', () => {
    renderHomeHeader({
      showFreeCloudProjectTrainingDisclosure: false,
      showLibraryBackLink: true,
    })

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
  it('shows cloud library helper text instead of the technical zoo source', () => {
    renderProjectLibraryPreviewRow(cloudLibrary)

    const libraryLink = screen.getByTestId('project-library-link')
    const summaryDescription = screen.getByTestId(
      'project-library-summary-description'
    )
    expect(libraryLink).toHaveTextContent('Personal Cloud')
    expect(summaryDescription).toHaveTextContent(
      'Projects in this library are saved to your Zoo account'
    )
    expect(summaryDescription).not.toHaveTextContent('zoo://personal')
    expect(screen.getByRole('tooltip', { hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent(
      'Technical source: zoo://personal'
    )
  })
})
