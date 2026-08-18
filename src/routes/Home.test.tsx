import type { ProjectLibrary } from '@src/lib/projectLibraries'
import {
  FREE_CLOUD_PROJECT_TRAINING_POLICY_URL,
  shouldShowFreeCloudProjectTrainingDisclosure,
} from '@src/lib/projectLibraries/trainingDisclosure'
import type { HomeProjectActionsService } from '@src/registry/contracts/homeProjects'
import { HomeHeader } from '@src/routes/HomeHeader'
import { ProjectLibraryPreviewRow } from '@src/routes/HomeProjectCards'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const cloudLibrary = {
  id: 'cloud-personal',
  title: 'Personal Cloud',
  path: '/documents/Zoo Projects',
  type: 'cloud',
} satisfies ProjectLibrary

const projectActions = {
  canOpen: vi.fn(() => false),
  canDuplicate: vi.fn(() => false),
  canRename: vi.fn(() => false),
  canDelete: vi.fn(() => false),
  canMoveToLibrary: vi.fn(() => false),
  canReviewDuplicateRealizations: vi.fn(() => false),
  open: vi.fn(async () => undefined),
  duplicate: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  delete: vi.fn(async () => undefined),
  getMoveToLibraryTargets: vi.fn(() => []),
  moveToLibrary: vi.fn(async () => undefined),
  deleteDuplicateRealizations: vi.fn(async () => undefined),
} satisfies HomeProjectActionsService

function renderHomeHeader({
  showFreeCloudProjectTrainingDisclosure,
}: {
  showFreeCloudProjectTrainingDisclosure: boolean
}) {
  render(
    <MemoryRouter>
      <HomeHeader
        title="Personal Cloud"
        library={cloudLibrary}
        setQuery={vi.fn()}
        sort="modified:desc"
        setSearchParams={vi.fn()}
        readWriteProjectDir={{ value: true, error: undefined }}
        showFreeCloudProjectTrainingDisclosure={
          showFreeCloudProjectTrainingDisclosure
        }
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
        showCloudSyncUi={true}
        onMoveToLibrary={vi.fn()}
      />
    </MemoryRouter>
  )
}

describe('HomeHeader', () => {
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
})

describe('ProjectLibraryPreviewRow', () => {
  it('shows cloud library helper text instead of the technical zoo source', () => {
    renderProjectLibraryPreviewRow(cloudLibrary)

    const libraryLink = screen.getByTestId('project-library-link')
    expect(libraryLink).toHaveTextContent('Personal Cloud')
    expect(libraryLink).toHaveTextContent(
      'Projects in this library sync to your Zoo account'
    )
    expect(libraryLink).not.toHaveTextContent('zoo://personal')
    expect(
      screen.getByTitle(/Technical source: zoo:\/\/personal/)
    ).toBeInTheDocument()
  })
})
