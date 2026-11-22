import {
  publishProjectFiles,
  getPublicationDetails,
} from '@src/lib/publishing/publication'
import {
  getRemoteProject,
  updateRemoteProject,
} from '@src/lib/cloudProjects/runtime/api'
import { beforeEach, expect, it, vi } from 'vitest'
import type * as Kittycad from '@kittycad/lib'

const remote = vi.hoisted(() => ({ publish: vi.fn(), details: vi.fn() }))
vi.mock('@kittycad/lib', async (original) => {
  const actual = await original<typeof Kittycad>()
  return {
    ...actual,
    projects: {
      ...actual.projects,
      publish_project: remote.publish,
      get_project: remote.details,
    },
  }
})
vi.mock('@src/lib/kcClient', () => ({
  createKCClient: vi.fn(() => ({})),
  kcCall: async (run: () => Promise<unknown>) => {
    try {
      return await run()
    } catch (error) {
      return error
    }
  },
}))
vi.mock('@src/lib/cloudProjects/runtime/api', () => ({
  getRemoteProject: vi.fn(),
  updateRemoteProject: vi.fn(),
  createRemoteProject: vi.fn(),
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRemoteProject).mockResolvedValue({
    id: 'captured',
    revision: '9',
  })
  vi.mocked(updateRemoteProject).mockResolvedValue({
    id: 'captured',
    revision: '10',
  })
  remote.publish.mockResolvedValue({ publication_status: 'pending_review' })
})

const args = {
  token: 'token',
  projectPath: '/cloud/captured',
  remoteProjectId: 'captured',
  expectedRevision: '7',
  deletedPaths: ['removed.kcl'],
  files: [
    {
      relativePath: 'main.kcl',
      data: new TextEncoder().encode('@settings(kclVersion = 3.0)\nwidth = 2'),
    },
  ],
  submission: {
    title: 'Bracket',
    description: '  hardware  ',
    categoryIds: ['hardware'],
  },
}

it('uploads captured files with the captured revision before requesting publication', async () => {
  await expect(publishProjectFiles(args)).resolves.toEqual({
    remoteProjectId: 'captured',
  })
  expect(updateRemoteProject).toHaveBeenCalledWith(
    expect.objectContaining({
      files: args.files,
      expectedRevision: '7',
      deletedPaths: ['removed.kcl'],
      publicationMetadata: {
        description: 'hardware',
        category_ids: ['hardware'],
      },
    })
  )
  expect(updateRemoteProject).toHaveBeenCalledBefore(remote.publish)
  expect(remote.publish).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'captured' })
  )
})

it('does not publish after a revision conflict', async () => {
  vi.mocked(updateRemoteProject).mockRejectedValue(
    new Error('Revision conflict')
  )
  await expect(publishProjectFiles(args)).resolves.toBe(false)
  expect(remote.publish).not.toHaveBeenCalled()
})

it('loads metadata by captured cloud identity without a legacy project', async () => {
  remote.details.mockResolvedValue({
    publication_status: 'published',
    title: 'Remote title',
    description: 'Remote description',
    category_ids: ['hardware'],
    publication: { last_published_at: 'today' },
    updated_at: 'today',
  })
  await expect(
    getPublicationDetails({
      token: 'token',
      projectId: 'captured',
      fallbackTitle: 'Fallback',
    })
  ).resolves.toEqual(
    expect.objectContaining({
      projectId: 'captured',
      title: 'Remote title',
      publicationStatus: 'published',
    })
  )
  expect(remote.details).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'captured' })
  )
})
