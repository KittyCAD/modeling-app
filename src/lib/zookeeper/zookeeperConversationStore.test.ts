import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/desktop', () => ({
  getAppSettingsFilePath: async () => '/tmp/settings.json',
}))

vi.mock('@src/lib/cloudSync/cloudApi', () => ({
  resolveRemoteProjectZookeeperConversation: vi.fn(),
  resetRemoteProjectZookeeperConversation: vi.fn(),
}))

import {
  createCloudProjectZookeeperConversationStore,
  jsonToZookeeperConversations,
  type ZookeeperConversationStore,
  zookeeperConversationsToJson,
} from '@src/lib/zookeeper/zookeeperConversationStore'
import {
  resetRemoteProjectZookeeperConversation,
  resolveRemoteProjectZookeeperConversation,
} from '@src/lib/cloudSync/cloudApi'

describe('zookeeperConversationStore', () => {
  it('round trips project conversation mappings', () => {
    const conversations = new Map([
      [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
    ])

    expect(
      jsonToZookeeperConversations(zookeeperConversationsToJson(conversations))
    ).toEqual(conversations)
  })

  it('drops malformed conversation mappings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(
        jsonToZookeeperConversations(
          JSON.stringify({
            'not-a-project-id': '22222222-2222-4222-8222-222222222222',
            '11111111-1111-4111-8111-111111111111': 'not-a-conversation-id',
            '33333333-3333-4333-8333-333333333333':
              '44444444-4444-4444-8444-444444444444',
          })
        )
      ).toEqual(
        new Map([
          [
            '33333333-3333-4333-8333-333333333333',
            '44444444-4444-4444-8444-444444444444',
          ],
        ])
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('resolves the server conversation for a cloud project and caches it locally', async () => {
    const localStore: ZookeeperConversationStore = {
      getProjectConversationId: vi.fn(async () => undefined),
      saveProjectConversationId: vi.fn(async () => undefined),
      deleteProjectConversationId: vi.fn(async () => undefined),
    }
    vi.mocked(resolveRemoteProjectZookeeperConversation).mockResolvedValue({
      conversation_id: 'server-conversation-id',
    })
    const store = createCloudProjectZookeeperConversationStore({
      cloudProjectId: 'cloud-project-id',
      token: 'token',
      localStore,
    })

    await expect(
      store.getProjectConversationId('local-project-id')
    ).resolves.toBe('server-conversation-id')
    expect(resolveRemoteProjectZookeeperConversation).toHaveBeenCalledWith(
      { enabled: true, token: 'token' },
      'cloud-project-id',
      undefined
    )
    expect(localStore.saveProjectConversationId).toHaveBeenCalledWith({
      projectId: 'local-project-id',
      conversationId: 'server-conversation-id',
    })
  })

  it('offers an existing local conversation when resolving a cloud project', async () => {
    const localStore: ZookeeperConversationStore = {
      getProjectConversationId: vi.fn(async () => 'local-conversation-id'),
      saveProjectConversationId: vi.fn(async () => undefined),
      deleteProjectConversationId: vi.fn(async () => undefined),
    }
    vi.mocked(resolveRemoteProjectZookeeperConversation).mockResolvedValue({
      conversation_id: 'local-conversation-id',
    })
    const store = createCloudProjectZookeeperConversationStore({
      cloudProjectId: 'cloud-project-id',
      localStore,
    })

    await store.getProjectConversationId('local-project-id')

    expect(resolveRemoteProjectZookeeperConversation).toHaveBeenCalledWith(
      { enabled: true, token: undefined },
      'cloud-project-id',
      'local-conversation-id'
    )
  })

  it('keeps an existing local conversation when cloud resolution is unavailable', async () => {
    const localStore: ZookeeperConversationStore = {
      getProjectConversationId: vi.fn(async () => 'local-conversation-id'),
      saveProjectConversationId: vi.fn(async () => undefined),
      deleteProjectConversationId: vi.fn(async () => undefined),
    }
    vi.mocked(resolveRemoteProjectZookeeperConversation).mockRejectedValue(
      new Error('offline')
    )
    const store = createCloudProjectZookeeperConversationStore({
      cloudProjectId: 'cloud-project-id',
      localStore,
    })

    await expect(
      store.getProjectConversationId('local-project-id')
    ).resolves.toBe('local-conversation-id')
  })

  it('rotates the server conversation when a cloud chat is cleared', async () => {
    const localStore: ZookeeperConversationStore = {
      getProjectConversationId: vi.fn(async () => 'old-conversation-id'),
      saveProjectConversationId: vi.fn(async () => undefined),
      deleteProjectConversationId: vi.fn(async () => undefined),
    }
    vi.mocked(resetRemoteProjectZookeeperConversation).mockResolvedValue({
      conversation_id: 'fresh-conversation-id',
    })
    const store = createCloudProjectZookeeperConversationStore({
      cloudProjectId: 'cloud-project-id',
      localStore,
    })

    await expect(
      store.resetProjectConversationId?.('local-project-id')
    ).resolves.toBe('fresh-conversation-id')
    expect(resetRemoteProjectZookeeperConversation).toHaveBeenCalledWith(
      { enabled: true, token: undefined },
      'cloud-project-id',
      'old-conversation-id'
    )
    expect(localStore.saveProjectConversationId).toHaveBeenCalledWith({
      projectId: 'local-project-id',
      conversationId: 'fresh-conversation-id',
    })
  })

  it('does not reset a cloud project before its conversation is resolved', async () => {
    vi.mocked(resetRemoteProjectZookeeperConversation).mockClear()
    const localStore: ZookeeperConversationStore = {
      getProjectConversationId: vi.fn(async () => undefined),
      saveProjectConversationId: vi.fn(async () => undefined),
      deleteProjectConversationId: vi.fn(async () => undefined),
    }
    const store = createCloudProjectZookeeperConversationStore({
      cloudProjectId: 'cloud-project-id',
      localStore,
    })

    await expect(
      store.resetProjectConversationId?.('local-project-id')
    ).rejects.toThrow('Cannot reset an unresolved cloud project conversation.')
    expect(resetRemoteProjectZookeeperConversation).not.toHaveBeenCalled()
  })
})
