import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/desktop', () => ({
  getAppSettingsFilePath: async () => '/tmp/settings.json',
}))

import {
  jsonToZookeeperConversations,
  zookeeperConversationsToJson,
} from '@src/lib/zookeeperConversationStore'

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
})
