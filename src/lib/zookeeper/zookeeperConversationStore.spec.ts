import {
  createRemoteProject,
  downloadRemoteProjectArchive,
} from '@src/lib/cloudSync/cloudApi'
import { parseProjectArchive } from '@src/lib/cloudSync/projectArchive'
import {
  overwriteProjectTomlWithNewSettings,
  writeProjectTitleToProjectToml,
} from '@src/lib/desktop'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { makeProjectZookeeperConversationStore } from '@src/lib/zookeeper/zookeeperConversationStore'
import JSZip from 'jszip'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const projectId = 'e29f9f4a-4aae-41a7-b3de-dfc4fe42dbd4'
const conversationId = 'b9e0a35a-56b8-4cb4-9c67-afc14bdf820f'
const settingsToml = `[settings.meta]\nid = "${projectId}"\n`
const initialToml = `title = "Bracket"\ndefault_file = "main.kcl"\n\n${settingsToml}`
let rootPath: string
let projectPath: string

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})

beforeEach(async () => {
  rootPath = `/tmp/zookeeper-project-sync-${crypto.randomUUID()}`
  projectPath = fsZds.join(rootPath, 'device-a', 'bracket')
  await fsZds.mkdir(projectPath, { recursive: true })
  await testFileOperations.writeFile(
    fsZds.join(projectPath, 'project.toml'),
    initialToml
  )
  await testFileOperations.writeFile(
    fsZds.join(projectPath, 'main.kcl'),
    'value = 42'
  )
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await fsZds.rm(rootPath, { recursive: true, force: true })
})

describe('project conversation persistence', () => {
  it('resumes from a cloud archive on a second device without a local mapping', async () => {
    const firstDevice = makeProjectZookeeperConversationStore(
      testFileOperations,
      projectPath,
      'zoo.dev'
    )
    await firstDevice.saveProjectConversationId({ projectId, conversationId })
    await overwriteProjectTomlWithNewSettings(
      testFileOperations,
      projectPath,
      settingsToml
    )

    const archive = new JSZip()
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'POST') {
        const form = init.body as FormData
        for (const path of ['project.toml', 'main.kcl']) {
          archive.file(path, await (form.get(path) as Blob).arrayBuffer())
        }
        return new Response(JSON.stringify({ id: 'remote-project' }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      expect(String(input)).toBe(
        'https://example.test/user/projects/remote-project/download?format=zip'
      )
      return new Response(await archive.generateAsync({ type: 'arraybuffer' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const config = { enabled: true, baseUrl: 'https://example.test' }
    const files = []
    for (const relativePath of ['project.toml', 'main.kcl']) {
      files.push({
        relativePath,
        data: await testFileOperations.readFile(
          fsZds.join(projectPath, relativePath)
        ),
      })
    }
    await createRemoteProject(config, projectPath, files)

    const downloaded = await parseProjectArchive(
      await downloadRemoteProjectArchive(config, 'remote-project')
    )
    const secondProjectPath = fsZds.join(rootPath, 'device-b', 'bracket')
    await fsZds.mkdir(secondProjectPath, {
      recursive: true,
    })
    for (const file of downloaded) {
      await testFileOperations.writeFile(
        fsZds.join(secondProjectPath, file.relativePath),
        file.data
      )
    }
    const readFile = vi.fn(testFileOperations.readFile)
    const secondDevice = makeProjectZookeeperConversationStore(
      { ...testFileOperations, readFile },
      secondProjectPath,
      'zoo.dev'
    )

    await expect(
      secondDevice.getProjectConversationId(projectId)
    ).resolves.toBe(conversationId)
    expect(readFile).toHaveBeenCalledExactlyOnceWith(
      fsZds.join(secondProjectPath, 'project.toml')
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['settings', 'title'])(
    'preserves a conversation saved concurrently with a %s update',
    async (update) => {
      vi.useFakeTimers()
      let contents = initialToml
      const pendingWrite = Promise.withResolvers<undefined>()
      const readFile = vi.fn(async () => new TextEncoder().encode(contents))
      const writeFile = vi.fn<typeof testFileOperations.writeFile>(
        async (_path, next) => {
          contents =
            typeof next === 'string' ? next : new TextDecoder().decode(next)
        }
      )
      writeFile.mockImplementationOnce(async (_path, next) => {
        await pendingWrite.promise
        contents =
          typeof next === 'string' ? next : new TextDecoder().decode(next)
      })
      const fileOperations = {
        ...testFileOperations,
        exists: vi.fn(async () => true),
        readFile,
        writeFile,
      }
      const store = makeProjectZookeeperConversationStore(
        fileOperations,
        projectPath,
        'zoo.dev'
      )
      const save = store.saveProjectConversationId({
        projectId,
        conversationId,
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(writeFile).toHaveBeenCalledOnce()
      const updatePromise =
        update === 'settings'
          ? overwriteProjectTomlWithNewSettings(
              fileOperations,
              projectPath,
              `${settingsToml}\n[settings.app]\nproject_directory = "/projects"\n`
            )
          : writeProjectTitleToProjectToml(
              fileOperations,
              projectPath,
              'Renamed'
            )
      await vi.advanceTimersByTimeAsync(0)
      expect(readFile).toHaveBeenCalledOnce()
      pendingWrite.resolve(undefined)
      await Promise.all([save, updatePromise])

      await expect(store.getProjectConversationId(projectId)).resolves.toBe(
        conversationId
      )
      expect(contents).toContain(
        update === 'settings'
          ? 'project_directory = "/projects"'
          : 'title = "Renamed"'
      )
    }
  )
})
