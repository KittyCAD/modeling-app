import { Registry } from '@kittycad/registry'
import { useSignals } from '@preact/signals-react/runtime'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import {
  FREE_CLOUD_PROJECT_TRAINING_POLICY_URL,
  shouldShowFreeCloudProjectTrainingDisclosure,
} from '@src/lib/projectLibraries/trainingDisclosure'
import type { HomeProjectActionsService } from '@src/registry/contracts/homeProjects'
import { projectSortingService } from '@src/registry/contracts/projectSorting'
import { urlService } from '@src/registry/contracts/url'
import projectSorting from '@src/registry/extensions/projectSorting'
import url, { createBrowserUrlAdapter } from '@src/registry/extensions/url'
import { getSortFunction } from '@src/lib/sorting'
import { HomeHeader } from '@src/routes/HomeHeader'
import { ProjectLibraryPreviewRow } from '@src/routes/HomeProjectCards'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const cloudLibrary = {
  id: 'cloud-personal',
  title: 'Personal Cloud',
  path: '/documents/Zoo Projects',
  type: 'cloud',
} satisfies ProjectLibrary

const projectActions = {
  watchRemoteThumbnail: vi.fn(() => vi.fn()),
  canOpen: vi.fn(() => false),
  canDuplicate: vi.fn(() => false),
  canRename: vi.fn(() => false),
  canDelete: vi.fn(() => false),
  canMoveToLibrary: vi.fn(() => false),
  canReviewDuplicateRealizations: vi.fn(() => false),
  canSeparateProjectCopies: vi.fn(() => false),
  open: vi.fn(async () => undefined),
  duplicate: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  delete: vi.fn(async () => undefined),
  getMoveToLibraryTargets: vi.fn(() => []),
  moveToLibrary: vi.fn(async () => undefined),
  deleteDuplicateRealizations: vi.fn(async () => undefined),
  separateProjectCopies: vi.fn(async () => undefined),
} satisfies HomeProjectActionsService

function renderHomeHeader({
  showFreeCloudProjectTrainingDisclosure,
  showLibraryBackLink = false,
}: {
  showFreeCloudProjectTrainingDisclosure: boolean
  showLibraryBackLink?: boolean
}) {
  render(
    <MemoryRouter>
      <HomeHeader
        title="Personal Cloud"
        library={cloudLibrary}
        setQuery={vi.fn()}
        sort="modified:desc"
        onSort={vi.fn()}
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
        onMoveToLibrary={vi.fn()}
      />
    </MemoryRouter>
  )
}

describe('HomeHeader', () => {
  it('sorts from application state while publishing the URL without dropping other fields', async () => {
    window.history.replaceState(null, '', '/home?keep=yes')
    const registry = new Registry()
    registry.configure([url, projectSorting])
    await registry.get(urlService).start(createBrowserUrlAdapter(window, false))
    const sorting = registry.get(projectSortingService)

    function ProjectList() {
      useSignals()
      const sort = sorting.sort.value
      const projects = [
        { name: 'alpha', modified: 30 },
        { name: 'zebra', modified: 10 },
      ].toSorted(getSortFunction(sort))
      return (
        <>
          <HomeHeader
            title="Projects"
            setQuery={vi.fn()}
            sort={sort}
            onSort={sorting.toggle}
            readWriteProjectDir={{ value: true, error: undefined }}
          />
          <ol aria-label="Projects">
            {projects.map((project) => (
              <li key={project.name}>{project.name}</li>
            ))}
          </ol>
        </>
      )
    }

    try {
      render(
        <MemoryRouter>
          <ProjectList />
        </MemoryRouter>
      )
      expect(
        screen.getAllByRole('listitem').map((item) => item.textContent)
      ).toEqual(['alpha', 'zebra'])
      fireEvent.click(screen.getByRole('button', { name: /Name$/ }))
      await waitFor(() => {
        expect(
          screen.getAllByRole('listitem').map((item) => item.textContent)
        ).toEqual(['zebra', 'alpha'])
      })
      expect(window.location.search).toBe('?keep=yes&sort_by=name')

      fireEvent.click(screen.getByRole('button', { name: /Last Modified$/ }))
      await waitFor(() => expect(sorting.sort.value).toBe('modified:desc'))
      expect(window.location.search).toBe('?keep=yes&sort_by=modified%3Adesc')
    } finally {
      registry[Symbol.dispose]()
      window.history.replaceState(null, '', '/')
    }
  })

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
      screen.getByText(/Projects in this library sync to your Zoo account/)
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
      'Projects in this library sync to your Zoo account'
    )
    expect(summaryDescription).not.toHaveTextContent('zoo://personal')
    expect(screen.getByRole('tooltip', { hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent(
      'Technical source: zoo://personal'
    )
  })
})
