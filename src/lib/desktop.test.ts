import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import { createNewProjectDirectory } from '@src/lib/desktop'
import fsZds, { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const createdProjectDirectoryPaths: string[] = []
const wasmInstance = {
  change_default_units: vi.fn((kcl: string, len: string) => {
    const defaultLengthUnit = JSON.parse(len)
    return `@settings(defaultLengthUnit = ${defaultLengthUnit})\n\n${kcl}`
  }),
  change_kcl_version: vi.fn((kcl: string, versionString: string) => {
    const version = JSON.parse(versionString)
    return `@settings(kclVersion = ${version})\n\n${kcl}`
  }),
} as unknown as ModuleType

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

describe('createNewProjectDirectory', () => {
  afterEach(async () => {
    await Promise.all(
      createdProjectDirectoryPaths.map((projectDirectoryPath) =>
        fsZds.rm(projectDirectoryPath, { recursive: true, force: true })
      )
    )
    createdProjectDirectoryPaths.length = 0
  })

  it('creates project.toml title metadata for new projects', async () => {
    const projectDirectoryPath = `/tmp/create-project-${crypto.randomUUID()}`
    createdProjectDirectoryPaths.push(projectDirectoryPath)

    const project = await createNewProjectDirectory(
      'Human Project',
      wasmInstance,
      undefined,
      {
        settings: {
          project: {
            directory: projectDirectoryPath,
          },
        },
      }
    )

    const projectToml = await fsZds.readFile(
      fsZds.join(project.path, PROJECT_SETTINGS_FILE_NAME),
      { encoding: 'utf-8' }
    )

    expect(project.title).toBe('Human Project')
    expect(projectToml).toContain('default_file = "main.kcl"')
    expect(projectToml).toContain('title = "Human Project"')
  })
})
