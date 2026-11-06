import { projects } from '@kittycad/lib'
import { createKCClient } from '@src/lib/kcClient'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

it('sends project requests to the requested API with the supplied credentials', async () => {
  const requests: Array<{ url: string; authorization: string | null }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('Authorization'),
      })
      return Response.json({ id: 'project-123' })
    })
  )

  await projects.get_project({
    client: createKCClient('test-token', 'https://api.example.test'),
    id: 'project-123',
  })

  expect(requests).toEqual([
    {
      url: 'https://api.example.test/user/projects/project-123',
      authorization: 'Bearer test-token',
    },
  ])
})
