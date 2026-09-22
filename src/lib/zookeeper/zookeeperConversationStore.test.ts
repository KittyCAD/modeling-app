import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

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
  },
}))

import {
  jsonToZookeeperConversations,
  makeZookeeperConversationStore,
  makeProjectZookeeperConversationStore,
  zookeeperConversationsToJson,
} from '@src/lib/zookeeper/zookeeperConversationStore'

const zookeeperConversationStore = makeZookeeperConversationStore(
  fsMocks as unknown as FileOperationsRegistryService
)

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

    fsMocks.readFile.mockImplementation(async () =>
      new TextEncoder().encode(contents)
    )
    fsMocks.writeFile.mockImplementation(
      async (_path: string, data: string | Uint8Array) => {
        if (fsMocks.writeFile.mock.calls.length === 1) {
          await firstWrite.promise
        }
        contents =
          typeof data === 'string' ? data : new TextDecoder().decode(data)
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

describe('project-backed Zookeeper conversations', () => {
  const projectId = '11111111-1111-4111-8111-111111111111'
  const conversationId = '22222222-2222-4222-8222-222222222222'
  const replacementId = '33333333-3333-4333-8333-333333333333'
  const projectPath = '/projects/bracket'
  const projectTomlPath = `${projectPath}/project.toml`
  const initialToml = `title = "Bracket"\n[settings.meta]\nid = "${projectId}"\n`
  let files: Map<string, string>

  const store = (environment = 'zoo.dev') =>
    makeProjectZookeeperConversationStore(
      fsMocks as unknown as FileOperationsRegistryService,
      projectPath,
      environment
    )

  beforeEach(() => {
    vi.clearAllMocks()
    files = new Map([
      [projectTomlPath, initialToml],
      ['/tmp/ml-conversations.json', '{}'],
    ])
    fsMocks.readFile.mockImplementation(async (path: string) => {
      const contents = files.get(path)
      if (contents === undefined) throw new Error('File not found')
      return new TextEncoder().encode(contents)
    })
    fsMocks.writeFile.mockImplementation(
      async (path: string, contents: string) => {
        files.set(path, contents)
      }
    )
  })

  it('resumes on another device using only the synced project.toml', async () => {
    await store().saveProjectConversationId({ projectId, conversationId })
    const syncedToml = files.get(projectTomlPath)!
    expect(syncedToml).toContain('[settings.zookeeper."zoo.dev"]')

    files = new Map([[projectTomlPath, syncedToml]])
    fsMocks.readFile.mockClear()
    await expect(store().getProjectConversationId(projectId)).resolves.toBe(
      conversationId
    )
    expect(fsMocks.readFile).toHaveBeenCalledExactlyOnceWith(projectTomlPath)
  })

  it('migrates the local mapping once and gives synced metadata priority', async () => {
    files.set(
      '/tmp/ml-conversations.json',
      JSON.stringify({ [projectId]: conversationId })
    )
    await expect(store().getProjectConversationId(projectId)).resolves.toBe(
      conversationId
    )
    expect(files.get(projectTomlPath)).toContain(conversationId)

    await store().saveProjectConversationId({
      projectId,
      conversationId: replacementId,
    })
    await expect(store().getProjectConversationId(projectId)).resolves.toBe(
      replacementId
    )
  })

  it('keeps a cleared conversation cleared even on a device with a stale local mapping', async () => {
    files.set(
      '/tmp/ml-conversations.json',
      JSON.stringify({ [projectId]: conversationId })
    )
    await store().deleteProjectConversationId(projectId)
    expect(files.get(projectTomlPath)).toContain('conversation_id = ""')
    await expect(
      store().getProjectConversationId(projectId)
    ).resolves.toBeUndefined()

    await store().saveProjectConversationId({
      projectId,
      conversationId: replacementId,
    })
    await expect(store().getProjectConversationId(projectId)).resolves.toBe(
      replacementId
    )
  })

  it('keeps environments separate without migrating an unscoped mapping into a second environment', async () => {
    files.set(
      '/tmp/ml-conversations.json',
      JSON.stringify({ [projectId]: conversationId })
    )
    await store().getProjectConversationId(projectId)
    await expect(
      store('dev.zoo.dev').getProjectConversationId(projectId)
    ).resolves.toBeUndefined()
    await store('dev.zoo.dev').saveProjectConversationId({
      projectId,
      conversationId: replacementId,
    })
    await expect(store().getProjectConversationId(projectId)).resolves.toBe(
      conversationId
    )
    await expect(
      store('dev.zoo.dev').getProjectConversationId(projectId)
    ).resolves.toBe(replacementId)
  })

  it('does not rewrite project.toml on resume or when saving the same ID', async () => {
    await store().saveProjectConversationId({ projectId, conversationId })
    fsMocks.writeFile.mockClear()
    await store().getProjectConversationId(projectId)
    await store().saveProjectConversationId({ projectId, conversationId })
    expect(fsMocks.writeFile).not.toHaveBeenCalled()
  })

  it('serializes pending saves and clear operations for a project', async () => {
    const write = deferred<undefined>()
    fsMocks.writeFile.mockImplementationOnce(
      async (path: string, contents: string) => {
        await write.promise
        files.set(path, contents)
      }
    )
    const saving = store().saveProjectConversationId({
      projectId,
      conversationId,
    })
    await vi.waitFor(() => expect(fsMocks.writeFile).toHaveBeenCalledOnce())
    const clearing = store().deleteProjectConversationId(projectId)
    write.resolve(undefined)
    await Promise.all([saving, clearing])
    await expect(
      store().getProjectConversationId(projectId)
    ).resolves.toBeUndefined()
  })

  it('does not continue migration when writing project.toml fails', async () => {
    files.set(
      '/tmp/ml-conversations.json',
      JSON.stringify({ [projectId]: conversationId })
    )
    fsMocks.writeFile.mockRejectedValueOnce(new Error('Permission denied'))
    await expect(store().getProjectConversationId(projectId)).rejects.toThrow(
      'Permission denied'
    )
    expect(files.get(projectTomlPath)).toBe(initialToml)
    await expect(store().getProjectConversationId(projectId)).resolves.toBe(
      conversationId
    )
  })

  it('rejects unreadable metadata and never falls back to the local mapping', async () => {
    fsMocks.readFile.mockRejectedValueOnce(new Error('Permission denied'))
    await expect(store().getProjectConversationId(projectId)).rejects.toThrow(
      'Permission denied'
    )
    expect(fsMocks.readFile).toHaveBeenCalledOnce()
    expect(fsMocks.writeFile).not.toHaveBeenCalled()
  })

  it('does not overwrite a project whose identity changed', async () => {
    await expect(
      store().saveProjectConversationId({
        projectId: replacementId,
        conversationId,
      })
    ).rejects.toThrow('Project identity changed')
    expect(files.get(projectTomlPath)).toBe(initialToml)
    expect(fsMocks.writeFile).not.toHaveBeenCalled()
  })

  it('rejects malformed conversation metadata without replacing it', async () => {
    const contents = `${initialToml}\n[settings.zookeeper."zoo.dev"]\nconversation_id = "invalid"\n`
    files.set(projectTomlPath, contents)
    await expect(store().getProjectConversationId(projectId)).rejects.toThrow(
      'Invalid Zookeeper conversation ID'
    )
    await expect(
      store().saveProjectConversationId({ projectId, conversationId })
    ).rejects.toThrow('Invalid Zookeeper conversation ID')
    expect(files.get(projectTomlPath)).toBe(contents)
    expect(fsMocks.writeFile).not.toHaveBeenCalled()
  })
})
