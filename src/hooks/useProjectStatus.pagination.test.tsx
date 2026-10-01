import { Client } from '@kittycad/lib'
import { useProjectStatuses } from '@src/hooks/useProjectStatus'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

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
