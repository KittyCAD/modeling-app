import { Client } from '@kittycad/lib'
import { useProjectStatuses } from '@src/hooks/useProjectStatus'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>())

vi.mock('@src/lib/kcClient', () => ({
  createKCClient: (token?: string) =>
    new Client({
      token,
      baseUrl: 'https://api.example.test',
      fetch: fetchMock,
    }),
}))

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(respond([]))
})

describe('useProjectStatuses', () => {
  test('fetches once and maps publication details by remote project ID', async () => {
    fetchMock.mockResolvedValue(
      respond([
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
    )

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
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/user/projects',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      })
    )
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
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('refetches when the set of linked Home projects changes', async () => {
    fetchMock
      .mockResolvedValueOnce(
        respond([
          {
            id: 'project-a',
            publication_status: 'pending_review',
            publication: { feedback: null },
          },
        ])
      )
      .mockResolvedValueOnce(
        respond([
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
      )

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
    expect(fetchMock).toHaveBeenCalledTimes(2)

    rerender({ homeProjects: [] })
    await waitFor(() => expect(result.current.size).toBe(0))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('includes statuses on later pages without publishing a partial list', async () => {
  let finishSecondPage: ((response: Response) => void) | undefined
  fetchMock
    .mockResolvedValueOnce(
      respond({
        items: [{ id: 'first', publication_status: 'published' }],
        next_page: 'second+/=',
      })
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSecondPage = resolve
        })
    )
  const { result } = renderHook(() =>
    useProjectStatuses([{ remoteProjectId: 'last' }], 'token-123')
  )
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(result.current.size).toBe(0)
  finishSecondPage?.(
    respond({
      items: [
        {
          id: 'last',
          publication_status: 'changes_requested',
          publication: { feedback: 'Update the thumbnail.' },
        },
      ],
      next_page: null,
    })
  )
  await waitFor(() =>
    expect(result.current.get('last')).toEqual({
      publicationStatus: 'changes_requested',
      feedback: 'Update the thumbnail.',
    })
  )
  expect(result.current.size).toBe(2)
  expect(fetchMock).toHaveBeenLastCalledWith(
    'https://api.example.test/user/projects?page_token=second%2B%2F%3D',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
    })
  )
})

test('does not publish first-page statuses when a later page fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchMock
    .mockResolvedValueOnce(
      respond({
        items: [{ id: 'first', publication_status: 'published' }],
        next_page: 'second',
      })
    )
    .mockResolvedValueOnce(respond({ message: 'temporarily unavailable' }, 503))
  const { result } = renderHook(() =>
    useProjectStatuses([{ remoteProjectId: 'first' }], 'token-123')
  )
  await waitFor(() => expect(console.error).toHaveBeenCalled())
  expect(result.current.size).toBe(0)
})
