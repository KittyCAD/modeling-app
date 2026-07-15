import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { EnvironmentConfiguration } from '@src/lib/constants'
import {
  canReadDirectory,
  canReadWriteDirectory,
  getEnvironmentConfigurationPath,
  getEnvironmentFilePath,
  getProjectInfo,
  listProjects,
  readEnvironmentConfigurationFile,
  readEnvironmentConfigurationToken,
  readEnvironmentFile,
} from '@src/lib/desktop'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import { webSafeJoin, webSafePathSplit } from '@src/lib/paths'
import type { DeepPartial } from '@src/lib/types'
import { buildTheWorldNode } from '@src/unitTestUtils'

const { mockElectron } = vi.hoisted(() => {
  // Mock the electron window global
  const mockElectron = {
    readdir: vi.fn(),
    access: vi.fn(),
    getPath: vi.fn(),
    cp: vi.fn(),
    rm: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    path: {
      join: vi.fn(),
      resolve: vi.fn(),
      relative: vi.fn(),
      extname: vi.fn(),
      sep: '/',
      basename: vi.fn(),
      dirname: vi.fn(),
    },
    stat: vi.fn(),
    statIsDirectory: vi.fn(),
    exists: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    platform: 'linux',
    os: {
      isMac: false,
      isWindows: false,
      isLinux: true,
    },
    process: {
      env: {},
    },
    kittycad: vi.fn(),
    canReadWriteDirectory: vi.fn(),
    getAppTestProperty: vi.fn(),
    packageJson: {
      name: '',
    },
  }

  vi.stubGlobal('window', {
    electron: mockElectron,
    localStorage: {
      getItem: (key: string) => undefined,
    },
  })

  return { mockElectron }
})

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.ElectronFS,
    options: {},
  })
})

describe('desktop utilities', () => {
  const mockConfig: DeepPartial<Configuration> = {
    settings: {
      project: {
        directory: '/test/projects',
      },
    },
  }

  const TEST_PROJECTS_CLEARED: string[] = []
  const TEST_PROJECTS_DEFAULT: string[] = [
    '.hidden-project',
    'valid-project',
    '.git',
    'project-without-kcl-files',
    'another-valid-project',
  ]

  const mockFileSystem: { [key: string]: string[] } = {
    '/test/projects': TEST_PROJECTS_DEFAULT,
    '/test/projects/valid-project': [
      'file1.kcl',
      'file2.stp',
      'notes.txt',
      'project.toml',
      'settings.toml',
      'boot.txt',
      'raw-metrics.txt',
      'environment.txt',
      '.gitignore',
      'file3.kcl',
      '.hidden-dir',
      'directory1',
      'dist',
    ],
    '/test/projects/valid-project/.hidden-dir': ['secret.txt'],
    '/test/projects/valid-project/directory1': [],
    '/test/projects/valid-project/dist': ['ignored.kcl'],
    '/test/projects/project-without-kcl-files': ['file3.glb'],
    '/test/projects/another-valid-project': [
      'file4.kcl',
      'directory2',
      'directory3',
    ],
    '/test/projects/another-valid-project/directory2': [],
    '/test/projects/another-valid-project/directory3': [],
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup default mock implementations
    mockElectron.path.join.mockImplementation((...parts: string[]) =>
      webSafeJoin(parts)
    )
    mockElectron.path.basename.mockImplementation((path: string) =>
      // The tests is hard coded to / so webSafe is defaulted to /
      webSafePathSplit(path).pop()
    )
    mockElectron.path.dirname.mockImplementation((path: string) =>
      // The tests is hard coded to / so webSafe is defaulted to /
      webSafeJoin(webSafePathSplit(path).slice(0, -1))
    )
    mockElectron.path.relative.mockImplementation(
      (from: string, to: string) => {
        const fromParts = webSafePathSplit(from)
        const toParts = webSafePathSplit(to)
        let sharedPrefixLength = 0
        while (
          sharedPrefixLength < fromParts.length &&
          sharedPrefixLength < toParts.length &&
          fromParts[sharedPrefixLength] === toParts[sharedPrefixLength]
        ) {
          sharedPrefixLength += 1
        }
        const up = fromParts.slice(sharedPrefixLength).map(() => '..')
        const down = toParts.slice(sharedPrefixLength)
        const relativePath = webSafeJoin([...up, ...down])
        return relativePath === '' ? '.' : relativePath
      }
    )

    // Mock readdir to return the entries for the given path
    mockElectron.readdir.mockImplementation(async (path: string) => {
      return mockFileSystem[path] || []
    })

    mockElectron.canReadWriteDirectory.mockImplementation(
      async (path: string) => {
        return { value: path in mockFileSystem, error: undefined }
      }
    )

    // Mock stat to always resolve with dummy metadata
    mockElectron.stat.mockImplementation(async (path: string) => {
      if (path in mockFileSystem) {
        return {
          mtimeMs: 123,
          atimeMs: 456,
          ctimeMs: 789,
          size: 100,
          mode: fsZdsConstants.S_IFDIR,
        }
      } else {
        return {
          mtimeMs: 123,
          atimeMs: 456,
          ctimeMs: 789,
          size: 100,
          mode: 0o666,
        }
      }
    })

    mockElectron.exists.mockResolvedValue(true)
    mockElectron.access.mockResolvedValue(undefined)
    mockElectron.readFile.mockImplementation(async (path: string) => {
      if (path === '/test/projects/valid-project/.gitignore') {
        return 'dist\nnotes.txt\n'
      }

      return ''
    })
    mockElectron.writeFile.mockResolvedValue(undefined)
    mockElectron.getPath.mockResolvedValue('/appData')
    mockElectron.kittycad.mockResolvedValue({})
  })

  describe('directory permissions', () => {
    it('distinguishes readable read-only directories from writable ones', async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)
      mockElectron.access.mockImplementation(
        async (_path: string, mode: number) => {
          if (mode === (fsZdsConstants.R_OK | fsZdsConstants.X_OK)) {
            return undefined
          }
          throw Object.assign(new Error('read-only'), { code: 'EACCES' })
        }
      )

      await expect(canReadDirectory('/test/projects')).resolves.toEqual({
        value: true,
        error: undefined,
      })
      await expect(
        canReadWriteDirectory('/test/projects')
      ).resolves.toMatchObject({ value: false })
      expect(mockElectron.access).toHaveBeenNthCalledWith(
        1,
        '/test/projects',
        fsZdsConstants.R_OK | fsZdsConstants.X_OK
      )
      expect(mockElectron.access).toHaveBeenNthCalledWith(
        2,
        '/test/projects',
        fsZdsConstants.R_OK | fsZdsConstants.W_OK | fsZdsConstants.X_OK
      )

      const { instance } = await buildTheWorldNode()
      const project = await getProjectInfo(
        '/test/projects/valid-project',
        await instance
      )
      expect(project).toMatchObject({
        readAccess: true,
        readWriteAccess: false,
        kcl_file_count: 2,
        directory_count: 1,
        default_file: '',
      })
      expect(project.children?.map((child) => child.name)).toContain(
        'file1.kcl'
      )
      consoleError.mockRestore()
    })
  })

  describe('listProjects', () => {
    it('does not list .git directories', async () => {
      const { instance } = await buildTheWorldNode()
      const projects = await listProjects(instance, mockConfig)
      expect(projects.map((p) => p.name)).not.toContain('.git')
    })
    it('lists projects excluding hidden and without .kcl files', async () => {
      const { instance } = await buildTheWorldNode()
      const projects = await listProjects(instance, mockConfig)

      // Verify only non-dot projects with .kcl files were included
      expect(projects.map((p) => p.name)).toEqual([
        'valid-project',
        'another-valid-project',
      ])

      // Verify we didn't try to get project info for dot directories
      expect(mockElectron.stat).not.toHaveBeenCalledWith(
        expect.stringContaining('/.hidden-project')
      )
      expect(mockElectron.stat).not.toHaveBeenCalledWith(
        expect.stringContaining('/.git')
      )

      // Verify that projects without .kcl files are not included
      expect(projects.map((p) => p.name)).not.toContain(
        'project-without-kcl-files'
      )
    })

    it('correctly counts directories and files', async () => {
      const { instance } = await buildTheWorldNode()
      const projects = await listProjects(instance, mockConfig)
      // Verify that directories and files are counted correctly
      expect(projects[0].directory_count).toEqual(1)
      expect(projects[0].kcl_file_count).toEqual(2)
      expect(projects[1].directory_count).toEqual(2)
      expect(projects[1].kcl_file_count).toEqual(1)
    })

    it('handles empty project directory', async () => {
      const { instance } = await buildTheWorldNode()
      // Adjust mockFileSystem to simulate empty directory
      mockFileSystem['/test/projects'] = TEST_PROJECTS_CLEARED

      const projects = await listProjects(instance, mockConfig)

      // Restore for future tests!
      mockFileSystem['/test/projects'] = TEST_PROJECTS_DEFAULT
      expect(projects).toEqual([])
    })

    it('includes a writable empty project after creating its default file', async () => {
      const emptyProjectName = 'new-empty-project'
      const emptyProjectPath = `/test/projects/${emptyProjectName}`
      const mainPath = `${emptyProjectPath}/main.kcl`
      const defaultStat = mockElectron.stat.getMockImplementation()!
      const originalNavigator = globalThis.navigator
      let mainCreated = false
      let mutationLockHeld = false
      const requestMutationLock = vi.fn(async (...args: unknown[]) => {
        const callback = args.at(-1) as (lock: Lock) => Promise<unknown>
        mutationLockHeld = true
        try {
          return await callback({} as Lock)
        } finally {
          mutationLockHeld = false
        }
      })
      vi.stubGlobal('navigator', {
        locks: { request: requestMutationLock },
      })
      TEST_PROJECTS_DEFAULT.push(emptyProjectName)
      mockFileSystem[emptyProjectPath] = []
      mockElectron.stat.mockImplementation(async (path: string) => {
        if (path === mainPath && !mainCreated) {
          expect(mutationLockHeld).toBe(true)
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }
        return defaultStat(path)
      })
      mockElectron.writeFile.mockImplementation(async (path: string) => {
        if (path === mainPath) {
          expect(mutationLockHeld).toBe(true)
          mainCreated = true
          mockFileSystem[emptyProjectPath].push('main.kcl')
        }
      })

      try {
        const { instance } = await buildTheWorldNode()
        const projects = await listProjects(instance, mockConfig)

        expect(projects.map((project) => project.name)).toContain(
          emptyProjectName
        )
        expect(mockElectron.writeFile).toHaveBeenCalledWith(
          mainPath,
          expect.any(Uint8Array)
        )
        expect(requestMutationLock).toHaveBeenCalled()
      } finally {
        vi.stubGlobal('navigator', originalNavigator)
        TEST_PROJECTS_DEFAULT.splice(
          TEST_PROJECTS_DEFAULT.indexOf(emptyProjectName),
          1
        )
        delete mockFileSystem[emptyProjectPath]
      }
    })

    it('shows all non-dot files except settings files in project contents', async () => {
      const { instance } = await buildTheWorldNode()
      const wasmInstance = await instance
      const instanceWithProjectSettings = {
        ...wasmInstance,
        parse_app_settings: vi.fn(() => ({})),
        parse_project_settings: vi.fn(() => ({})),
      }
      const project = await getProjectInfo(
        '/test/projects/valid-project',
        instanceWithProjectSettings
      )

      expect(project.children?.map((child) => child.name)).toEqual([
        'file1.kcl',
        'file3.kcl',
        'file2.stp',
        'boot.txt',
        'raw-metrics.txt',
        'environment.txt',
        'directory1',
      ])
    })

    it('reads project title and cloud id from project.toml metadata', async () => {
      mockElectron.readFile.mockImplementation(async (path: string) => {
        if (path === '/test/projects/valid-project/.gitignore') {
          return 'dist\nnotes.txt\n'
        }
        if (path === '/test/projects/valid-project/project.toml') {
          return 'title = "Some demo"\n\n[cloud."dev.zoo.dev"]\nproject_id = "project-123"\n'
        }

        return ''
      })

      const { instance } = await buildTheWorldNode()
      const wasmInstance = await instance
      const project = await getProjectInfo('/test/projects/valid-project', {
        ...wasmInstance,
        parse_app_settings: vi.fn(() => ({})),
        parse_project_settings: vi.fn(() => ({})),
      })

      expect(project.title).toBe('Some demo')
      expect(project.cloudProjectId).toBe('project-123')
    })

    it('shows config and dot files when app settings enable all files', async () => {
      mockElectron.readFile.mockImplementation(async (path: string) => {
        if (path === '/appData/settings.toml') {
          return '[settings.app]\nshow_all_files = true\n'
        }
        if (path === '/test/projects/valid-project/.gitignore') {
          return 'dist\nnotes.txt\n'
        }

        return ''
      })

      const { instance } = await buildTheWorldNode()
      const wasmInstance = await instance
      const instanceWithAppSettings = {
        ...wasmInstance,
        parse_app_settings: vi.fn(() => ({
          settings: { app: { show_all_files: true } },
        })),
      }
      const project = await getProjectInfo(
        '/test/projects/valid-project',
        instanceWithAppSettings
      )

      expect(project.children?.map((child) => child.name)).toEqual([
        'file1.kcl',
        'file3.kcl',
        'file2.stp',
        'project.toml',
        'settings.toml',
        'boot.txt',
        'raw-metrics.txt',
        'environment.txt',
        '.gitignore',
        '.hidden-dir',
        'directory1',
      ])
    })
  })

  describe('getEnvironmentConfigurationPath', () => {
    it('should return a wonky path because appConfig is not set by default', async () => {
      const expected = '/appData//envs/development.json'
      const actual = await getEnvironmentConfigurationPath('development')
      expect(actual).toBe(expected)
    })
    it('should return path to the configuration file for development', async () => {
      const expected = '/appData/zoo-modeling-app/envs/development.json'
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const actual = await getEnvironmentConfigurationPath('development')
      mockElectron.packageJson.name = ''
      expect(actual).toBe(expected)
    })
    it('should return path to the configuration file for production', async () => {
      const expected = '/appData/zoo-modeling-app/envs/production.json'
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const actual = await getEnvironmentConfigurationPath('production')
      mockElectron.packageJson.name = ''
      expect(actual).toBe(expected)
    })
  })

  describe('getEnvironmentPath', () => {
    it('should return a wonky path because appConfig is not set by default', async () => {
      const expected = '/appData//environment.txt'
      const actual = await getEnvironmentFilePath()
      expect(actual).toBe(expected)
    })
    it('should return path to the environment.txt file', async () => {
      const expected = '/appData/zoo-modeling-app/environment.txt'
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const actual = await getEnvironmentFilePath()
      mockElectron.packageJson.name = ''
      expect(actual).toBe(expected)
    })
  })

  describe('readEnvironmentConfigurationFile', () => {
    it('should return null for development', async () => {
      const expected = null
      const actual = await readEnvironmentConfigurationFile('dev.zoo.dev')
      expect(actual).toBe(expected)
    })
    it('should return a empty string object for development', async () => {
      mockElectron.exists.mockImplementation(() => true)
      mockElectron.readFile.mockImplementation(() => {
        return '{"token":"","domain":"dev.zoo.dev"}'
      })
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const expected: EnvironmentConfiguration = {
        domain: 'dev.zoo.dev',
        token: '',
      }
      const actual = await readEnvironmentConfigurationFile('dev.zoo.dev')

      // mock clean up
      mockElectron.packageJson.name = ''
      expect(actual).toStrictEqual(expected)
    })
    it('should return an empty string object for production', async () => {
      mockElectron.exists.mockImplementation(() => true)
      mockElectron.readFile.mockImplementation(() => {
        return '{"token":"","domain":"zoo.dev"}'
      })
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const expected: EnvironmentConfiguration = {
        domain: 'zoo.dev',
        token: '',
      }
      const actual = await readEnvironmentConfigurationFile('zoo.dev')

      // mock clean up
      mockElectron.packageJson.name = ''
      expect(actual).toStrictEqual(expected)
    })
  })

  describe('readEnvironmentFile', () => {
    it('should return the empty string', async () => {
      const expected = ''
      const actual = await readEnvironmentFile()
      expect(actual).toBe(expected)
    })
    it('should return development', async () => {
      const expected = 'dev.zoo.dev'
      mockElectron.exists.mockImplementation(() => true)
      mockElectron.readFile.mockImplementation(() => 'dev.zoo.dev')
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const actual = await readEnvironmentFile()
      mockElectron.packageJson.name = ''
      expect(actual).toBe(expected)
    })
    it('should return production', async () => {
      const expected = 'zoo.dev'
      mockElectron.exists.mockImplementation(() => true)
      mockElectron.readFile.mockImplementation(() => 'zoo.dev')
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const actual = await readEnvironmentFile()
      mockElectron.packageJson.name = ''
      expect(actual).toBe(expected)
    })
  })

  describe('readEnvironmentConfigurationToken', () => {
    it('should return the empty string for dev.zoo.dev', async () => {
      const expected = ''
      const actual = await readEnvironmentConfigurationToken('dev.zoo.dev')
      expect(actual).toBe(expected)
    })
    it('should return the empty string for production', async () => {
      const expected = ''
      const actual = await readEnvironmentConfigurationToken('zoo.dev')
      expect(actual).toBe(expected)
    })
    it('should return the string dog-dog-dog for development', async () => {
      mockElectron.exists.mockImplementation(() => true)
      mockElectron.readFile.mockImplementation(() => {
        return '{"token":"dog-dog-dog","domain":"development"}'
      })
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const expected = 'dog-dog-dog'
      const actual = await readEnvironmentConfigurationToken('development')
      // mock clean up
      mockElectron.packageJson.name = ''
      expect(actual).toBe(expected)
    })
    it('should return the string cat-cat-cat for production', async () => {
      mockElectron.exists.mockImplementation(() => true)
      mockElectron.readFile.mockImplementation(() => {
        return '{"token":"cat-cat-cat","domain":"production"}'
      })
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const expected = 'cat-cat-cat'
      const actual = await readEnvironmentConfigurationToken('production')
      // mock clean up
      mockElectron.packageJson.name = ''
      expect(actual).toBe(expected)
    })
  })
})
