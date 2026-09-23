import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('@src/lib/desktop', () => ({
  getAppSettingsFilePath: async () => '/tmp/settings.json',
  isPathNotFoundError: (error: { code?: string }) => error?.code === 'ENOENT',
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
  deleteLegacyProjectConversationId,
  makeProjectZookeeperConversationStore,
  zookeeperConversationsToJson,
} from '@src/lib/zookeeper/zookeeperConversationStore'
import { getZookeeperConversationMetadataFromProjectTomlContents } from '@src/lib/projectTomlMetadata'

const fileOperations = fsMocks as unknown as FileOperationsRegistryService

beforeEach(() => {
  fsMocks.readFile.mockReset()
  fsMocks.writeFile.mockReset()
})

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

  it('serializes legacy deletions and preserves unrelated mappings', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111'
    const conversationId = '22222222-2222-4222-8222-222222222222'
    const otherProjectId = '33333333-3333-4333-8333-333333333333'
    const untouchedProjectId = '44444444-4444-4444-8444-444444444444'
    const firstWrite = deferred<undefined>()
    let contents = JSON.stringify({
      [projectId]: conversationId,
      [otherProjectId]: conversationId,
      [untouchedProjectId]: conversationId,
    })

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

    const deletion = deleteLegacyProjectConversationId(
      fileOperations,
      projectId
    )
    await vi.waitFor(() => expect(fsMocks.writeFile).toHaveBeenCalledOnce())
    const otherDeletion = deleteLegacyProjectConversationId(
      fileOperations,
      otherProjectId
    )

    await Promise.resolve()
    expect(fsMocks.readFile).toHaveBeenCalledOnce()

    firstWrite.resolve(undefined)
    await Promise.all([deletion, otherDeletion])
    expect(JSON.parse(contents)).toEqual({
      [untouchedProjectId]: conversationId,
    })
  })

  it.each(['unreadable', 'corrupt'])(
    'does not overwrite %s legacy JSON during cleanup',
    async (legacyState) => {
      if (legacyState === 'unreadable') {
        fsMocks.readFile.mockRejectedValueOnce(
          Object.assign(new Error('Permission denied'), { code: 'EACCES' })
        )
      } else {
        fsMocks.readFile.mockResolvedValueOnce(
          new TextEncoder().encode('{corrupt')
        )
      }

      await expect(
        deleteLegacyProjectConversationId(
          fileOperations,
          '11111111-1111-4111-8111-111111111111'
        )
      ).rejects.toThrow()
      expect(fsMocks.writeFile).not.toHaveBeenCalled()
    }
  )
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
    files = new Map([
      [projectTomlPath, initialToml],
      ['/tmp/ml-conversations.json', '{}'],
    ])
    fsMocks.readFile.mockImplementation(async (path: string) => {
      const contents = files.get(path)
      if (contents === undefined) {
        throw Object.assign(new Error('File not found'), { code: 'ENOENT' })
      }
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
    expect(
      getZookeeperConversationMetadataFromProjectTomlContents(
        syncedToml,
        'zoo.dev'
      )
    ).toMatchObject({ conversationIds: [conversationId] })
    expect(syncedToml).toContain('conversation_ids =')

    files = new Map([[projectTomlPath, syncedToml]])
    fsMocks.readFile.mockClear()
    await expect(store().getProjectConversationId(projectId)).resolves.toBe(
      conversationId
    )
    expect(fsMocks.readFile.mock.calls).toEqual([[projectTomlPath]])
  })

  it('imports the legacy ID without changing mappings for this or unopened projects', async () => {
    const legacy = JSON.stringify({
      [projectId]: conversationId,
      [replacementId]: conversationId,
    })
    files.set('/tmp/ml-conversations.json', legacy)
    await expect(store().getProjectConversationId(projectId)).resolves.toBe(
      conversationId
    )
    expect(files.get(projectTomlPath)).toContain(conversationId)
    expect(files.get('/tmp/ml-conversations.json')).toBe(legacy)
  })

  it.each(['mismatched', 'corrupt'])(
    'uses the synced list without reading %s legacy JSON',
    async (legacyState) => {
      files.set(
        '/tmp/ml-conversations.json',
        legacyState === 'corrupt'
          ? '{corrupt'
          : JSON.stringify({ [projectId]: conversationId })
      )
      await store().saveProjectConversationId({
        projectId,
        conversationId: replacementId,
      })
      const contents = files.get(projectTomlPath)
      fsMocks.readFile.mockClear()
      fsMocks.writeFile.mockClear()

      await expect(store().getProjectConversationId(projectId)).resolves.toBe(
        replacementId
      )
      expect(fsMocks.readFile.mock.calls).toEqual([[projectTomlPath]])
      expect(fsMocks.writeFile).not.toHaveBeenCalled()
      expect(files.get(projectTomlPath)).toBe(contents)
    }
  )

  it.each([false, true])(
    'keeps cleared history cleared on another device, with existing metadata: %s',
    async (hasSavedConversation) => {
      if (hasSavedConversation) {
        await store().saveProjectConversationId({ projectId, conversationId })
      }
      await store().deleteProjectConversationId(projectId)
      const clearedToml = files.get(projectTomlPath)!
      expect(clearedToml).toContain('conversation_ids = []')

      // Another device still has its own legacy mapping after receiving the TOML.
      const legacy = JSON.stringify({ [projectId]: conversationId })
      files = new Map([
        [projectTomlPath, clearedToml],
        ['/tmp/ml-conversations.json', legacy],
      ])
      fsMocks.writeFile.mockClear()
      await expect(
        store().getProjectConversationId(projectId)
      ).resolves.toBeUndefined()
      await store().deleteProjectConversationId(projectId)
      expect(fsMocks.writeFile).not.toHaveBeenCalled()

      await store().saveProjectConversationId({
        projectId,
        conversationId: replacementId,
      })
      await expect(store().getProjectConversationId(projectId)).resolves.toBe(
        replacementId
      )
      expect(
        getZookeeperConversationMetadataFromProjectTomlContents(
          files.get(projectTomlPath)!,
          'zoo.dev'
        )
      ).toMatchObject({ conversationIds: [replacementId] })
      expect(files.get('/tmp/ml-conversations.json')).toBe(legacy)
    }
  )

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
    expect(
      getZookeeperConversationMetadataFromProjectTomlContents(
        files.get(projectTomlPath)!,
        'dev.zoo.dev'
      )
    ).toMatchObject({ conversationIds: [replacementId] })
    await store('dev.zoo.dev').deleteProjectConversationId(projectId)
    await expect(
      store('dev.zoo.dev').getProjectConversationId(projectId)
    ).resolves.toBeUndefined()
    await expect(store().getProjectConversationId(projectId)).resolves.toBe(
      conversationId
    )
  })

  it('appends new IDs without duplicating or reordering existing conversations', async () => {
    await store().saveProjectConversationId({ projectId, conversationId })
    await store().saveProjectConversationId({
      projectId,
      conversationId: replacementId,
    })
    const contents = files.get(projectTomlPath)!
    expect(
      getZookeeperConversationMetadataFromProjectTomlContents(
        contents,
        'zoo.dev'
      )
    ).toMatchObject({ conversationIds: [conversationId, replacementId] })

    fsMocks.writeFile.mockClear()
    await store().saveProjectConversationId({
      projectId,
      conversationId: replacementId,
    })
    await store().saveProjectConversationId({ projectId, conversationId })
    await expect(store().getProjectConversationId(projectId)).resolves.toBe(
      replacementId
    )
    expect(files.get(projectTomlPath)).toBe(contents)
    expect(fsMocks.writeFile).not.toHaveBeenCalled()
  })

  it('serializes saves and clear so a pending save cannot restore cleared history', async () => {
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
    const cleared = store().getProjectConversationId(projectId)
    const nextChat = store().saveProjectConversationId({
      projectId,
      conversationId: replacementId,
    })
    write.resolve(undefined)
    await Promise.all([saving, clearing, nextChat])
    await expect(cleared).resolves.toBeUndefined()
    await expect(store().getProjectConversationId(projectId)).resolves.toBe(
      replacementId
    )
    expect(
      getZookeeperConversationMetadataFromProjectTomlContents(
        files.get(projectTomlPath)!,
        'zoo.dev'
      )
    ).toMatchObject({ conversationIds: [replacementId] })
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

  it('keeps the saved conversation when clearing fails and supports retry', async () => {
    await store().saveProjectConversationId({ projectId, conversationId })
    const contents = files.get(projectTomlPath)
    fsMocks.writeFile.mockRejectedValueOnce(new Error('Permission denied'))
    await expect(
      store().deleteProjectConversationId(projectId)
    ).rejects.toThrow('Permission denied')
    expect(files.get(projectTomlPath)).toBe(contents)
    await expect(store().getProjectConversationId(projectId)).resolves.toBe(
      conversationId
    )
    await store().deleteProjectConversationId(projectId)
    await expect(
      store().getProjectConversationId(projectId)
    ).resolves.toBeUndefined()
  })

  it('rejects unreadable legacy metadata without a saved conversation, then retries', async () => {
    files.set(
      '/tmp/ml-conversations.json',
      JSON.stringify({ [projectId]: conversationId })
    )
    const original = files.get(projectTomlPath)
    const readFile = fsMocks.readFile.getMockImplementation()!
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith('ml-conversations.json')) {
        throw Object.assign(new Error('Permission denied'), {
          code: 'EACCES',
        })
      }
      return readFile(path)
    })
    await expect(store().getProjectConversationId(projectId)).rejects.toThrow(
      'Permission denied'
    )
    expect(files.get(projectTomlPath)).toBe(original)

    fsMocks.readFile.mockImplementation(readFile)
    await expect(store().getProjectConversationId(projectId)).resolves.toBe(
      conversationId
    )
    expect(files.get(projectTomlPath)).toContain(conversationId)
  })

  it('rejects corrupt legacy JSON without starting a replacement chat', async () => {
    files.set('/tmp/ml-conversations.json', '{corrupt')
    await expect(store().getProjectConversationId(projectId)).rejects.toThrow()
    expect(fsMocks.writeFile).not.toHaveBeenCalled()
  })

  it('allows a new chat when the legacy file does not exist', async () => {
    files.delete('/tmp/ml-conversations.json')
    await expect(
      store().getProjectConversationId(projectId)
    ).resolves.toBeUndefined()
    expect(fsMocks.writeFile).not.toHaveBeenCalled()
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

  it.each([
    'conversation_ids = "invalid"',
    `conversation_ids = ["${conversationId}", "invalid"]`,
    'conversation_ids = [42]',
  ])(
    'rejects malformed conversation metadata without replacing it: %s',
    async (metadata) => {
      const contents = `${initialToml}\n[settings.zookeeper."zoo.dev"]\n${metadata}\n`
      files.set(projectTomlPath, contents)
      await expect(store().getProjectConversationId(projectId)).rejects.toThrow(
        'Invalid Zookeeper conversation ID'
      )
      await expect(
        store().saveProjectConversationId({ projectId, conversationId })
      ).rejects.toThrow('Invalid Zookeeper conversation ID')
      expect(files.get(projectTomlPath)).toBe(contents)
      expect(fsMocks.writeFile).not.toHaveBeenCalled()
    }
  )
})
