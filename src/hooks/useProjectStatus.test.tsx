import { useProjectStatuses } from '@src/hooks/useProjectStatus'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  client: { mocked: true },
  createKCClient: vi.fn(),
  listProjects: vi.fn(),
}))

vi.mock('@kittycad/lib', () => ({
  projects: {
    get_project: vi.fn(),
    list_projects: mockState.listProjects,
  },
}))

vi.mock('@src/lib/kcClient', () => ({
  createKCClient: mockState.createKCClient,
}))

describe('useProjectStatuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.createKCClient.mockReturnValue(mockState.client)
    mockState.listProjects.mockResolvedValue([])
  })

  test('fetches once and maps publication details by remote project ID', async () => {
    mockState.listProjects.mockResolvedValue([
      {
        id: 'project-pending',
        publication_status: 'pending_review',
        publication: { feedback: null },
      },
      {
        id: 'project-changes-requested',
        publication_status: 'changes_requested',
        publication: { feedback: 'Add another view.' },
      },
    ])

    const { result } = renderHook(() =>
      useProjectStatuses(
        [
          { remoteProjectId: 'project-pending' },
          { remoteProjectId: 'project-changes-requested' },
        ],
        'token-123'
      )
    )

    await waitFor(() =>
      expect(result.current.get('project-pending')).toEqual({
        publicationStatus: 'pending_review',
        feedback: undefined,
      })
    )
    expect(result.current.get('project-changes-requested')).toEqual({
      publicationStatus: 'changes_requested',
      feedback: 'Add another view.',
    })
    expect(mockState.createKCClient).toHaveBeenCalledWith('token-123')
    expect(mockState.listProjects).toHaveBeenCalledTimes(1)
    expect(mockState.listProjects).toHaveBeenCalledWith({
      client: mockState.client,
    })
  })

  test.each([
    { homeProjects: [], token: 'token-123' },
    { homeProjects: [{}], token: 'token-123' },
    {
      homeProjects: [{ remoteProjectId: 'project-pending' }],
      token: undefined,
    },
  ])('skips fetching without authentication or a remote project', (args) => {
    const { result } = renderHook(() =>
      useProjectStatuses(args.homeProjects, args.token)
    )

    expect(result.current.size).toBe(0)
    expect(mockState.listProjects).not.toHaveBeenCalled()
  })

  test('refetches when the set of linked Home projects changes', async () => {
    mockState.listProjects
      .mockResolvedValueOnce([
        {
          id: 'project-a',
          publication_status: 'pending_review',
          publication: { feedback: null },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'project-a',
          publication_status: 'pending_review',
          publication: { feedback: null },
        },
        {
          id: 'project-b',
          publication_status: 'published',
          publication: { feedback: null },
        },
      ])

    const { result, rerender } = renderHook(
      ({ homeProjects }) => useProjectStatuses(homeProjects, 'token-123'),
      {
        initialProps: {
          homeProjects: [{ remoteProjectId: 'project-a' }],
        },
      }
    )

    await waitFor(() =>
      expect(result.current.get('project-a')?.publicationStatus).toBe(
        'pending_review'
      )
    )

    rerender({
      homeProjects: [
        { remoteProjectId: 'project-a' },
        { remoteProjectId: 'project-b' },
      ],
    })

    await waitFor(() =>
      expect(result.current.get('project-b')?.publicationStatus).toBe(
        'published'
      )
    )
    expect(mockState.listProjects).toHaveBeenCalledTimes(2)

    rerender({ homeProjects: [] })
    await waitFor(() => expect(result.current.size).toBe(0))
  })
})
