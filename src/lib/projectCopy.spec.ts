import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { copyProjectToLibrary } from '@src/lib/projectCopy'
import { createProjectInLocalDirectory } from '@src/lib/projectLibraries/operations'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ProjectLibraryCreateProjectInput } from '@src/registry/contracts/projectLibraries'
import { buildTheWorldNode } from '@src/unitTestUtils'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'

let wasmInstance: ModuleType
const roots: string[] = []
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  wasmInstance = await (await buildTheWorldNode()).instance
})
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    roots
      .splice(0)
      .map((path) => fsZds.rm(path, { recursive: true, force: true }))
  )
})

async function fixture() {
  const root = `/tmp/project-copy-${crypto.randomUUID()}`
  roots.push(root)
  const sourcePath = fsZds.join(root, 'readonly')
  const destination = fsZds.join(root, 'writable')
  await fsZds.mkdir(fsZds.join(sourcePath, 'parts'), { recursive: true })
  await fsZds.mkdir(destination, { recursive: true })
  const write = async (name: string, contents: string | Uint8Array) =>
    fsZds.writeFile(
      fsZds.join(sourcePath, name),
      typeof contents === 'string'
        ? new TextEncoder().encode(contents)
        : Uint8Array.from(contents)
    )
  await write('parts/entry.kcl', 'saved = 1\n')
  await write(
    'project.toml',
    'title = "Source"\ndefault_file = "parts/entry.kcl"\n[settings.meta]\nid = "a5df514b-99a6-4ae8-9fc7-c4a248f99a42"\n[cloud."zoo.dev"]\nproject_id = "remote-original"\n[zookeeper."zoo.dev"]\nconversation_ids = ["old-conversation"]\n'
  )
  const target = {
    library: {
      id: 'writable',
      title: 'Writable',
      path: destination,
      type: 'directory',
    },
    createProject: {
      run: vi.fn((input: ProjectLibraryCreateProjectInput) =>
        createProjectInLocalDirectory({
          ...input,
          fileOperations: testFileOperations,
          projectDirectoryPath: destination,
          wasmInstancePromise: wasmInstance,
        })
      ),
    },
  }
  return { root, sourcePath, target, write }
}

async function readText(path: string) {
  return new TextDecoder().decode(await fsZds.readFile(path))
}

test('copies nested files, ignored attachments and current editor buffers with independent metadata', async () => {
  const { sourcePath, target, write, root } = await fixture()
  const otherDriveFile = 'D:/other/main.kcl'
  const relative = fsZds.relative.bind(fsZds)
  vi.spyOn(fsZds, 'relative').mockImplementation((...paths) =>
    paths[1] === otherDriveFile ? otherDriveFile : relative(...paths)
  )
  await write('.gitignore', '*.bin\n')
  await write('parts/model.bin', new Uint8Array([0, 255, 1]))
  await fsZds.mkdir(fsZds.join(sourcePath, '._meta'), { recursive: true })
  await write('._meta/private', 'internal')
  const project = await copyProjectToLibrary({
    fileOperations: testFileOperations,
    sourcePath,
    title: 'My editable copy',
    target,
    editorFiles: [
      {
        path: fsZds.join(sourcePath, 'parts/entry.kcl'),
        contents: 'unsaved = 2\n',
      },
      {
        path: fsZds.join(root, 'another-project.kcl'),
        contents: 'private = 3\n',
      },
      { path: otherDriveFile, contents: 'another drive buffer' },
    ],
  })
  expect(project?.default_file).toBe(
    fsZds.join(project!.path, 'parts/entry.kcl')
  )
  await expect(readText(project!.default_file)).resolves.toBe('unsaved = 2\n')
  expect([
    ...(await fsZds.readFile(fsZds.join(project!.path, 'parts/model.bin'))),
  ]).toEqual([0, 255, 1])
  const toml = await readText(fsZds.join(project!.path, 'project.toml'))
  expect(toml).toContain('title = "My editable copy"')
  expect(toml).not.toContain('a5df514b-99a6-4ae8-9fc7-c4a248f99a42')
  expect(toml).not.toContain('remote-original')
  expect(toml).not.toContain('zookeeper')
  expect(await fsZds.readdir(project!.path)).not.toContain('D:')
  expect(
    target.createProject.run.mock.calls[0][0].initialProject?.files.map(
      (file) => file.requestedFileName
    )
  ).not.toContain('../another-project.kcl')
  await expect(
    fsZds.stat(fsZds.join(project!.path, '._meta/private'))
  ).rejects.toBeDefined()
  await expect(
    readText(fsZds.join(sourcePath, 'parts/entry.kcl'))
  ).resolves.toBe('saved = 1\n')
  await expect(
    readText(fsZds.join(sourcePath, 'project.toml'))
  ).resolves.toContain('remote-original')
})
