import { describe, expect, test } from 'vitest'

import {
  privateProjectLinkLoader,
  sharedProjectLinkLoader,
} from '@src/lib/routeLoaders'

describe('sharedProjectLinkLoader', () => {
  test('normalizes a shared-project path to the query-param open flow', async () => {
    const result = await sharedProjectLinkLoader({
      params: {
        key: 'share-key-123',
      },
      request: new Request('https://app.zoo.dev/projects/shared/share-key-123'),
    } as unknown as Parameters<typeof sharedProjectLinkLoader>[0])

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(302)
    expect((result as Response).headers.get('Location')).toBe(
      '/?shared-project=share-key-123&ask-open-desktop=true'
    )
  })

  test('normalizes a private-project path to the query-param open flow', async () => {
    const result = await privateProjectLinkLoader({
      params: {
        id: 'project-789',
      },
      request: new Request('https://app.zoo.dev/projects/project-789'),
    } as unknown as Parameters<typeof privateProjectLinkLoader>[0])

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(302)
    expect((result as Response).headers.get('Location')).toBe(
      '/?private-project=project-789&ask-open-desktop=true&immediate-sign-in-if-necessary=true'
    )
  })
})
