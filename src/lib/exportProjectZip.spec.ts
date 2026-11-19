import { tmpdir } from 'node:os'
import {
  clearActiveTextFile,
  flushActiveTextFileWrite,
  openActiveTextFile,
  scheduleActiveTextFileWrite,
} from '@src/lib/activeTextFile'
import {
  createProjectZipArchive,
  exportProjectZip,
} from '@src/lib/exportProjectZip'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { buildTheWorldNode } from '@src/unitTestUtils'
import JSZip from 'jszip'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const createdProjectPaths: string[] = []
let wasmInstance: ModuleType

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
  const { instance } = await buildTheWorldNode()
  wasmInstance = await instance
})

function makeProject(
  projectPath: string,
  overrides: Partial<Project> = {}
): Project {
  return {
    metadata: null,
    kcl_file_count: 2,
    directory_count: 2,
    default_file: fsZds.join(projectPath, 'main.kcl'),
    path: projectPath,
    name: 'web-project',
    children: null,
    readWriteAccess: true,
    ...overrides,
  }
}

describe('createProjectZipArchive', () => {
  afterEach(async () => {
    await Promise.all(
      createdProjectPaths.map((projectPath) =>
        fsZds.rm(projectPath, { recursive: true, force: true })
      )
    )
    createdProjectPaths.length = 0
  })

  it('zips project files with the current KCL buffer and excludes repository metadata', async () => {
    const projectPath = fsZds.join(
      tmpdir(),
      `export-project-zip-${crypto.randomUUID()}`
    )
    createdProjectPaths.push(projectPath)

    await fsZds.mkdir(fsZds.join(projectPath, 'parts'), { recursive: true })
    await fsZds.mkdir(fsZds.join(projectPath, '.hidden-dir'), {
      recursive: true,
    })
    await fsZds.mkdir(fsZds.join(projectPath, '.git'))
    await fsZds.writeFile(
      fsZds.join(projectPath, '.git', 'HEAD'),
      new TextEncoder().encode('ref: main')
    )
    await fsZds.writeFile(
      fsZds.join(projectPath, '._meta'),
      new TextEncoder().encode('internal metadata')
    )
    await fsZds.writeFile(
      fsZds.join(projectPath, 'main.kcl'),
      new TextEncoder().encode('disk = true')
    )
    await fsZds.writeFile(
      fsZds.join(projectPath, 'parts', 'nested.kcl'),
      new TextEncoder().encode('nested = true')
    )
    await fsZds.writeFile(
      fsZds.join(projectPath, '.hidden-dir', 'secret.txt'),
      new TextEncoder().encode('secret')
    )
    await fsZds.writeFile(
      fsZds.join(projectPath, 'project.toml'),
      new TextEncoder().encode('default_file = "main.kcl"')
    )

    const archive = await createProjectZipArchive({
      fileOperations: testFileOperations,
      project: makeProject(projectPath),
      currentFilePath: fsZds.join(projectPath, 'main.kcl'),
      currentFileContents: 'unsaved = true',
      wasmInstance,
    })

    if (archive instanceof Error) {
      throw archive
    }

    expect(archive.fileName).toBe('web-project.zip')
    const zip = await JSZip.loadAsync(archive.contents)

    expect(zip.file('web-project/.git/HEAD')).toBeNull()
    expect(zip.file('web-project/._meta')).toBeNull()
    await expect(
      zip.file('web-project/main.kcl')?.async('string')
    ).resolves.toBe('unsaved = true')
    await expect(
      zip.file('web-project/parts/nested.kcl')?.async('string')
    ).resolves.toBe('nested = true')
    await expect(
      zip.file('web-project/.hidden-dir/secret.txt')?.async('string')
    ).resolves.toBe('secret')
    await expect(
      zip.file('web-project/project.toml')?.async('string')
    ).resolves.toBe('default_file = "main.kcl"')
  })

  it('saves a project archive with pending text edits through the desktop file picker', async () => {
    const projectPath = fsZds.join(
      tmpdir(),
      `export-project-zip-${crypto.randomUUID()}`
    )
    createdProjectPaths.push(projectPath)

    await fsZds.mkdir(projectPath, { recursive: true })
    await fsZds.writeFile(
      fsZds.join(projectPath, 'main.kcl'),
      new TextEncoder().encode('disk = true')
    )
    const readmePath = fsZds.join(projectPath, 'README.md')
    await fsZds.writeFile(readmePath, new TextEncoder().encode('Saved README'))
    await openActiveTextFile(testFileOperations, readmePath)

    const filePath = fsZds.join(projectPath, 'saved.zip')
    const save = vi.fn().mockResolvedValue({ canceled: false, filePath })
    vi.stubGlobal('electron', { save, process: { env: {} } })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      scheduleActiveTextFileWrite(
        testFileOperations,
        readmePath,
        'Edited README'
      )
      await exportProjectZip({
        fileOperations: testFileOperations,
        project: makeProject(projectPath, {
          name: '550e8400-e29b-41d4-a716-446655440000',
          title: 'Human Project',
        }),
        wasmInstance,
      })
    } finally {
      await flushActiveTextFileWrite()
      clearActiveTextFile()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }

    expect(save).toHaveBeenCalledWith({
      defaultPath: 'Human Project.zip',
      filters: [{ name: 'model', extensions: ['zip'] }],
    })
    const zip = await JSZip.loadAsync(await fsZds.readFile(filePath))

    await expect(
      zip.file('Human Project/main.kcl')?.async('string')
    ).resolves.toBe('disk = true')
    await expect(
      zip.file('Human Project/README.md')?.async('string')
    ).resolves.toBe('Edited README')
  })
})
