import type { ProjectLibrary } from '@src/lib/projectLibraries'
import {
  FREE_CLOUD_PROJECT_TRAINING_POLICY_URL,
  shouldShowFreeCloudProjectTrainingDisclosure,
} from '@src/lib/projectLibraries/trainingDisclosure'
import { HomeHeader } from '@src/routes/HomeHeader'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const cloudLibrary = {
  id: 'cloud-personal',
  title: 'Personal Cloud',
  path: '/documents/Zoo Projects',
  type: 'cloud',
} satisfies ProjectLibrary

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
