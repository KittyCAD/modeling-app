import JSZip from 'jszip'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createProjectZipArchive } from '@src/lib/exportProjectZip'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { buildTheWorldNode } from '@src/unitTestUtils'

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

  it('zips every project file and uses the current editor contents for the active file', async () => {
    const projectPath = `/tmp/export-project-zip-${crypto.randomUUID()}`
    createdProjectPaths.push(projectPath)

    await fsZds.mkdir(fsZds.join(projectPath, 'parts'), { recursive: true })
    await fsZds.mkdir(fsZds.join(projectPath, '.hidden-dir'), {
      recursive: true,
    })
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
      project: makeProject(projectPath),
      currentFilePath: fsZds.join(projectPath, 'main.kcl'),
      currentFileContents: 'unsaved = true',
      wasmInstance,
    })

    if (archive instanceof Error) {
      throw archive
    }

    expect(archive.fileName).toBe('web-project.zip')
    const zip = await JSZip.loadAsync(await archive.blob.arrayBuffer())

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

  it('uses the project title for the ZIP name and root when it differs from the folder name', async () => {
    const projectPath = `/tmp/export-project-zip-${crypto.randomUUID()}`
    createdProjectPaths.push(projectPath)

    await fsZds.mkdir(projectPath, { recursive: true })
    await fsZds.writeFile(
      fsZds.join(projectPath, 'main.kcl'),
      new TextEncoder().encode('disk = true')
    )

    const archive = await createProjectZipArchive({
      project: makeProject(projectPath, {
        name: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Human Project',
      }),
      wasmInstance,
    })

    if (archive instanceof Error) {
      throw archive
    }

    expect(archive.fileName).toBe('Human Project.zip')
    const zip = await JSZip.loadAsync(await archive.blob.arrayBuffer())

    await expect(
      zip.file('Human Project/main.kcl')?.async('string')
    ).resolves.toBe('disk = true')
  })
})
