import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), fetch: vi.fn() }))
vi.mock('@kittycad/lib', () => ({
  ml: { list_conversations_for_user: mocks.list },
}))
vi.mock('@src/lib/kcClient', () => ({
  createKCClient: (token: string) => ({ token, fetch: mocks.fetch }),
}))

import { loadZookeeperConversationDetails } from '@src/lib/zookeeper/conversationDetails'

const item = (id: string) => ({
  id,
  first_prompt: `Prompt for ${id}`,
  created_at: '2026-09-23T12:00:00Z',
})

describe('project conversation labels', () => {
  beforeEach(() => vi.resetAllMocks())

  it('filters other projects and stops paging when all saved IDs are found', async () => {
    mocks.list.mockResolvedValueOnce({
      items: [item('unrelated'), item('new')],
      next_page: 'older-page',
    })
    mocks.list.mockResolvedValueOnce({
      items: [item('old')],
      next_page: 'unused-page',
    })
    const details = await loadZookeeperConversationDetails(
      ['old', 'new'],
      'token',
      new AbortController().signal
    )
    expect(Object.keys(details)).toEqual(['new', 'old'])
    expect(details.old).toEqual({
      first_prompt: 'Prompt for old',
      created_at: '2026-09-23T12:00:00Z',
    })
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page_token: 'older-page',
        client: expect.objectContaining({ token: 'token' }),
      })
    )
  })

  it('leaves unavailable conversations without labels instead of dropping their IDs', async () => {
    mocks.list.mockResolvedValue({ items: [item('visible')] })
    await expect(
      loadZookeeperConversationDetails(
        ['visible', 'unavailable'],
        'token',
        new AbortController().signal
      )
    ).resolves.toEqual({
      visible: {
        first_prompt: 'Prompt for visible',
        created_at: '2026-09-23T12:00:00Z',
      },
    })
    expect(mocks.list).toHaveBeenCalledOnce()
  })

  it('cancels outstanding requests and stops paging when the picker closes', async () => {
    const abort = new AbortController()
    mocks.list.mockImplementationOnce(async ({ client }) => {
      await client.fetch('/ml/conversations')
      abort.abort()
      return { items: [], next_page: 'next' }
    })
    await loadZookeeperConversationDetails(['old'], 'token', abort.signal)
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/ml/conversations',
      expect.objectContaining({ signal: abort.signal })
    )
    expect(mocks.list).toHaveBeenCalledOnce()
  })

  it('does not request metadata for an empty project or cancelled picker', async () => {
    const abort = new AbortController()
    await loadZookeeperConversationDetails([], 'token', abort.signal)
    abort.abort()
    await loadZookeeperConversationDetails(['old'], 'token', abort.signal)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('propagates metadata failures so the picker can offer retry', async () => {
    mocks.list.mockRejectedValue(new Error('Offline'))
    await expect(
      loadZookeeperConversationDetails(
        ['old'],
        'token',
        new AbortController().signal
      )
    ).rejects.toThrow('Offline')
  })
})
