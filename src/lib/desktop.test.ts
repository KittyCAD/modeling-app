import { tmpdir } from 'node:os'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import {
  createNewProjectDirectory,
  overwriteProjectTomlWithNewSettings,
} from '@src/lib/desktop'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
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

const createTempDirectoryPath = () =>
  fsZds.join(tmpdir(), `create-project-${crypto.randomUUID()}`)

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
    const projectDirectoryPath = createTempDirectoryPath()
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
    const projectDirectoryPath = createTempDirectoryPath()
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

  it('uses the default directory library when creating new projects from settings', async () => {
    const projectDirectoryPath = createTempDirectoryPath()
    const legacyProjectDirectoryPath = createTempDirectoryPath()
    createdProjectDirectoryPaths.push(projectDirectoryPath)
    createdProjectDirectoryPaths.push(legacyProjectDirectoryPath)

    const project = await createNewProjectDirectory(
      'library-project',
      wasmInstance,
      undefined,
      {
        settings: {
          app: {
            libraries: [
              {
                title: 'Projects',
                path: projectDirectoryPath,
                type: 'directory',
              },
            ],
          },
          project: {
            directory: legacyProjectDirectoryPath,
          },
        },
      }
    )

    expect(project.path).toBe(
      fsZds.join(projectDirectoryPath, 'library-project')
    )
  })

  it('treats serialized ENOENT strings as missing project.toml metadata', async () => {
    const projectDirectoryPath = createTempDirectoryPath()
    createdProjectDirectoryPaths.push(projectDirectoryPath)
    await fsZds.mkdir(fsZds.join(projectDirectoryPath, 'Serialized ENOENT'), {
      recursive: true,
    })

    const originalReadFile = fsZds.readFile
    let hasThrownSerializedEnoent = false
    fsZds.readFile = (async (filePath: string, options?: unknown) => {
      if (
        !hasThrownSerializedEnoent &&
        fsZds.basename(filePath) === PROJECT_SETTINGS_FILE_NAME
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
    const projectDirectoryPath = createTempDirectoryPath()
    createdProjectDirectoryPaths.push(projectDirectoryPath)
    await fsZds.mkdir(fsZds.join(projectDirectoryPath, 'Electron ENOENT'), {
      recursive: true,
    })

    const originalReadFile = fsZds.readFile
    let hasThrownElectronEnoent = false
    fsZds.readFile = (async (filePath: string, options?: unknown) => {
      if (
        !hasThrownElectronEnoent &&
        fsZds.basename(filePath) === PROJECT_SETTINGS_FILE_NAME
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

  it('does not read project.toml before writing metadata for newly created project directories', async () => {
    const projectDirectoryPath = createTempDirectoryPath()
    createdProjectDirectoryPaths.push(projectDirectoryPath)

    const originalReadFile = fsZds.readFile
    let attemptedProjectTomlRead = false
    fsZds.readFile = (async (filePath: string, options?: unknown) => {
      if (fsZds.basename(filePath) === PROJECT_SETTINGS_FILE_NAME) {
        attemptedProjectTomlRead = true
        return Promise.reject(
          new Error(`UNKNOWN: unknown error, open '${filePath}'`)
        )
      }

      return originalReadFile(filePath, options as never)
    }) as typeof fsZds.readFile

    let projectPath = ''
    try {
      const project = await createNewProjectDirectory(
        'Windows Dropbox',
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
      projectPath = project.path

      expect(attemptedProjectTomlRead).toBe(false)
      expect(project.title).toBe('Windows Dropbox')
    } finally {
      fsZds.readFile = originalReadFile
    }

    const projectToml = await fsZds.readFile(
      fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME),
      { encoding: 'utf-8' }
    )

    expect(projectToml).toContain('title = "Windows Dropbox"')
  })

  it('preserves project metadata when writing project settings', async () => {
    const projectDirectoryPath = createTempDirectoryPath()
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
