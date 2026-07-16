import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import {
  createNewProjectDirectory,
  overwriteProjectTomlWithNewSettings,
} from '@src/lib/desktop'
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

  it('can create project directories with separate project titles', async () => {
    const projectDirectoryPath = `/tmp/create-project-${crypto.randomUUID()}`
    createdProjectDirectoryPaths.push(projectDirectoryPath)

    const project = await createNewProjectDirectory(
      'human-project',
      wasmInstance,
      undefined,
      {
        settings: {
          project: {
            directory: projectDirectoryPath,
          },
        },
      },
      undefined,
      undefined,
      'Human Project'
    )

    const projectToml = await fsZds.readFile(
      fsZds.join(project.path, PROJECT_SETTINGS_FILE_NAME),
      { encoding: 'utf-8' }
    )

    expect(project.name).toBe('human-project')
    expect(project.title).toBe('Human Project')
    expect(projectToml).toContain('title = "Human Project"')
  })

  it('treats serialized ENOENT strings as missing project.toml metadata', async () => {
    const projectDirectoryPath = `/tmp/create-project-${crypto.randomUUID()}`
    createdProjectDirectoryPaths.push(projectDirectoryPath)

    const originalReadFile = fsZds.readFile
    let hasThrownSerializedEnoent = false
    fsZds.readFile = (async (filePath: string, options?: unknown) => {
      if (
        !hasThrownSerializedEnoent &&
        filePath.endsWith(`/${PROJECT_SETTINGS_FILE_NAME}`)
      ) {
        hasThrownSerializedEnoent = true
        return Promise.reject(
          `ENOENT: no such file or directory, open '${filePath}'`
        )
      }

      return originalReadFile(filePath, options as never)
    }) as typeof fsZds.readFile

    try {
      const project = await createNewProjectDirectory(
        'Serialized ENOENT',
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

      expect(hasThrownSerializedEnoent).toBe(true)
      expect(project.title).toBe('Serialized ENOENT')
      expect(projectToml).toContain('title = "Serialized ENOENT"')
    } finally {
      fsZds.readFile = originalReadFile
    }
  })

  it('treats Electron ENOENT errors as missing project.toml metadata', async () => {
    const projectDirectoryPath = `/tmp/create-project-${crypto.randomUUID()}`
    createdProjectDirectoryPaths.push(projectDirectoryPath)

    const originalReadFile = fsZds.readFile
    let hasThrownElectronEnoent = false
    fsZds.readFile = (async (filePath: string, options?: unknown) => {
      if (
        !hasThrownElectronEnoent &&
        filePath.endsWith(`/${PROJECT_SETTINGS_FILE_NAME}`)
      ) {
        hasThrownElectronEnoent = true
        return Promise.reject(
          new Error(`ENOENT: no such file or directory, open '${filePath}'`)
        )
      }

      return originalReadFile(filePath, options as never)
    }) as typeof fsZds.readFile

    try {
      const project = await createNewProjectDirectory(
        'Electron ENOENT',
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

      expect(hasThrownElectronEnoent).toBe(true)
      expect(project.title).toBe('Electron ENOENT')
      expect(projectToml).toContain('title = "Electron ENOENT"')
    } finally {
      fsZds.readFile = originalReadFile
    }
  })

  it('preserves project metadata when writing project settings', async () => {
    const projectDirectoryPath = `/tmp/create-project-${crypto.randomUUID()}`
    const projectPath = fsZds.join(projectDirectoryPath, 'test-1')
    createdProjectDirectoryPaths.push(projectDirectoryPath)

    await fsZds.mkdir(projectPath, { recursive: true })
    await fsZds.writeFile(
      fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME),
      new TextEncoder().encode(
        'title = "Test-1"\ndefault_file = "main.kcl"\n\n[cloud."dev.zoo.dev"]\nproject_id = "project-123"\n\n[settings.meta]\nid = "old-settings-id"\n'
      )
    )

    await overwriteProjectTomlWithNewSettings(
      projectPath,
      '[settings.meta]\nid = "new-settings-id"\n'
    )

    const projectToml = await fsZds.readFile(
      fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME),
      { encoding: 'utf-8' }
    )

    expect(projectToml).toContain('title = "Test-1"')
    expect(projectToml).toContain('default_file = "main.kcl"')
    expect(projectToml).toContain('[cloud."dev.zoo.dev"]')
    expect(projectToml).toContain('project_id = "project-123"')
    expect(projectToml).toContain('id = "new-settings-id"')
    expect(projectToml).not.toContain('old-settings-id')
  })
})
