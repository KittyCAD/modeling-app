import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import {
  type DuplicateProjectResult,
  duplicateProjectInDirectory,
} from '@src/lib/projectDuplication'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { buildTheWorldNode } from '@src/unitTestUtils'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

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

async function makeProject({
  directoryName = 'source-project',
  mainKcl = 'disk = true',
  projectToml = 'title = "Source project"\ndefault_file = "main.kcl"\n',
}: {
  directoryName?: string
  mainKcl?: string
  projectToml?: string
} = {}) {
  const projectDirectoryPath = `/tmp/duplicate-project-${crypto.randomUUID()}`
  const sourcePath = fsZds.join(projectDirectoryPath, directoryName)
  createdProjectPaths.push(projectDirectoryPath)

  await fsZds.mkdir(sourcePath, { recursive: true })
  await fsZds.writeFile(
    fsZds.join(sourcePath, 'main.kcl'),
    new TextEncoder().encode(mainKcl)
  )
  await fsZds.writeFile(
    fsZds.join(sourcePath, 'project.toml'),
    new TextEncoder().encode(projectToml)
  )

  return {
    directoryName,
    projectDirectoryPath,
    sourcePath,
  }
}

async function duplicateSourceProject({
  directoryName,
  projectDirectoryPath,
  sourcePath,
  currentFilePath,
  currentFileContents,
}: Awaited<ReturnType<typeof makeProject>> & {
  currentFilePath?: string | null
  currentFileContents?: string
}) {
  const result = await duplicateProjectInDirectory({
    source: {
      directoryName,
      displayName: 'Source project',
      path: sourcePath,
    },
    projectDirectoryPath,
    requestedProjectTitle: 'Source project',
    currentFilePath,
    currentFileContents,
    wasmInstance,
  })
  const targetPath = fsZds.join(projectDirectoryPath, result.name)

  return { result, targetPath }
}

async function readText(path: string) {
  return new TextDecoder().decode(await fsZds.readFile(path))
}

describe('duplicateProjectInDirectory', () => {
  afterEach(async () => {
    await Promise.all(
      createdProjectPaths.map((projectPath) =>
        fsZds.rm(projectPath, { recursive: true, force: true })
      )
    )
    createdProjectPaths.length = 0
  })

  it('uses the current editor contents for the active file when duplicating a project', async () => {
    const project = await makeProject({
      mainKcl: 'disk = true',
    })

    const { result, targetPath } = await duplicateSourceProject({
      ...project,
      currentFilePath: fsZds.join(project.sourcePath, 'main.kcl'),
      currentFileContents: 'editor = true',
    })

    expect(result).toEqual<DuplicateProjectResult>({
      message:
        'Successfully duplicated "Source project" as "Source project-copy"',
      name: 'source-project-copy',
      title: 'Source project-copy',
    })
    await expect(readText(fsZds.join(targetPath, 'main.kcl'))).resolves.toBe(
      'editor = true'
    )
    await expect(
      readText(fsZds.join(project.sourcePath, 'main.kcl'))
    ).resolves.toBe('editor = true')
  })

  it('keeps duplicated project metadata even when project.toml is the active file', async () => {
    const project = await makeProject()

    const { targetPath } = await duplicateSourceProject({
      ...project,
      currentFilePath: fsZds.join(project.sourcePath, 'project.toml'),
      currentFileContents: 'title = "Unsaved source metadata edit"\n',
    })

    await expect(
      readText(fsZds.join(targetPath, 'project.toml'))
    ).resolves.toContain('title = "Source project-copy"')
    await expect(
      readText(fsZds.join(targetPath, 'project.toml'))
    ).resolves.not.toContain('Unsaved source metadata edit')
  })
})
