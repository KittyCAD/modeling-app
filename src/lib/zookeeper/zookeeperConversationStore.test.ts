import { describe, expect, it, vi } from 'vitest'

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('@src/lib/desktop', () => ({
  getAppSettingsFilePath: async () => '/tmp/settings.json',
}))

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    dirname: (path: string) => path.slice(0, path.lastIndexOf('/')),
    join: (...parts: string[]) =>
      parts.reduce((left, right) => (left ? `${left}/${right}` : right), ''),
    readFile: fsMocks.readFile,
    writeFile: fsMocks.writeFile,
  },
}))

import {
  jsonToZookeeperConversations,
  zookeeperConversationStore,
  zookeeperConversationsToJson,
} from '@src/lib/zookeeper/zookeeperConversationStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

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

  it('serializes persistence operations', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111'
    const conversationId = '22222222-2222-4222-8222-222222222222'
    const firstWrite = deferred<undefined>()
    let contents = '{}'

    fsMocks.readFile.mockImplementation(async () => contents)
    fsMocks.writeFile.mockImplementation(
      async (_path: string, data: Uint8Array) => {
        if (fsMocks.writeFile.mock.calls.length === 1) {
          await firstWrite.promise
        }
        contents = new TextDecoder().decode(data)
      }
    )

    const save = zookeeperConversationStore.saveProjectConversationId({
      projectId,
      conversationId,
    })
    await vi.waitFor(() => expect(fsMocks.writeFile).toHaveBeenCalledOnce())
    const deletion =
      zookeeperConversationStore.deleteProjectConversationId(projectId)
    const read = zookeeperConversationStore.getProjectConversationId(projectId)

    await Promise.resolve()
    expect(fsMocks.readFile).toHaveBeenCalledOnce()

    firstWrite.resolve(undefined)
    await Promise.all([save, deletion])
    await expect(read).resolves.toBeUndefined()
    expect(contents).toBe('{}')
  })
})
