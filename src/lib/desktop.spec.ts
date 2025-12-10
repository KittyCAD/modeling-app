import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'

import type { EnvironmentConfiguration } from '@src/lib/constants'
import {
  getEnvironmentConfigurationPath,
  getEnvironmentFilePath,
  listProjects,
  readEnvironmentConfigurationFile,
  readEnvironmentConfigurationToken,
  readEnvironmentFile,
} from '@src/lib/desktop'
import { webSafeJoin, webSafePathSplit } from '@src/lib/paths'
import type { DeepPartial } from '@src/lib/types'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

// Mock the electron window global
const mockElectron = {
  readdir: vi.fn(),
  path: {
    join: vi.fn(),
    basename: vi.fn(),
    dirname: vi.fn(),
  },
  stat: vi.fn(),
  statIsDirectory: vi.fn(),
  exists: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  os: {
    isMac: false,
    isWindows: false,
  },
  process: {
    env: {},
  },
  getPath: vi.fn(),
  kittycad: vi.fn(),
  canReadWriteDirectory: vi.fn(),
  getAppTestProperty: vi.fn(),
  packageJson: {
    name: '',
  },
}

vi.stubGlobal('window', { electron: mockElectron })

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
      'file3.kcl',
      'directory1',
    ],
    '/test/projects/valid-project/directory1': [],
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

    // Mock readdir to return the entries for the given path
    mockElectron.readdir.mockImplementation(async (path: string) => {
      return mockFileSystem[path] || []
    })

    // Mock statIsDirectory to return true if the path exists in mockFileSystem
    mockElectron.statIsDirectory.mockImplementation(async (path: string) => {
      return path in mockFileSystem
    })

    mockElectron.canReadWriteDirectory.mockImplementation(
      async (path: string) => {
        return { value: path in mockFileSystem, error: undefined }
      }
    )

    // Mock stat to always resolve with dummy metadata
    mockElectron.stat.mockResolvedValue({
      mtimeMs: 123,
      atimeMs: 456,
      ctimeMs: 789,
      size: 100,
      mode: 0o666,
    })

    mockElectron.exists.mockResolvedValue(true)
    mockElectron.readFile.mockResolvedValue('')
    mockElectron.writeFile.mockResolvedValue(undefined)
    mockElectron.getPath.mockResolvedValue('/appData')
    mockElectron.kittycad.mockResolvedValue({})
  })

  describe('listProjects', () => {
    it('does not list .git directories', async () => {
      const { instance } = await buildTheWorldAndNoEngineConnection()
      if (!window.electron) throw new Error('Electron not found')
      const projects = await listProjects(window.electron, mockConfig, instance)
      expect(projects.map((p) => p.name)).not.toContain('.git')
    })
    it('lists projects excluding hidden and without .kcl files', async () => {
      const { instance } = await buildTheWorldAndNoEngineConnection()
      if (!window.electron) throw new Error('Electron not found')
      const projects = await listProjects(window.electron, mockConfig, instance)

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
      const { instance } = await buildTheWorldAndNoEngineConnection()
      if (!window.electron) throw new Error('Electron not found')
      const projects = await listProjects(window.electron, mockConfig, instance)
      // Verify that directories and files are counted correctly
      expect(projects[0].directory_count).toEqual(1)
      expect(projects[0].kcl_file_count).toEqual(2)
      expect(projects[1].directory_count).toEqual(2)
      expect(projects[1].kcl_file_count).toEqual(1)
    })

    it('handles empty project directory', async () => {
      const { instance } = await buildTheWorldAndNoEngineConnection()
      if (!window.electron) throw new Error('Electron not found')
      // Adjust mockFileSystem to simulate empty directory
      mockFileSystem['/test/projects'] = TEST_PROJECTS_CLEARED

      const projects = await listProjects(window.electron, mockConfig, instance)

      // Restore for future tests!
      mockFileSystem['/test/projects'] = TEST_PROJECTS_DEFAULT
      expect(projects).toEqual([])
    })
  })

  describe('getEnvironmentConfigurationPath', () => {
    it('should return a wonky path because appConfig is not set by default', async () => {
      if (!window.electron) throw new Error('Electron not found')
      const expected = '/appData//envs/development.json'
      const actual = await getEnvironmentConfigurationPath(
        window.electron,
        'development'
      )
      expect(actual).toBe(expected)
    })
    it('should return path to the configuration file for development', async () => {
      const expected = '/appData/zoo-modeling-app/envs/development.json'
      if (!window.electron) throw new Error('Electron not found')
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const actual = await getEnvironmentConfigurationPath(
        window.electron,
        'development'
      )
      mockElectron.packageJson.name = ''
      expect(actual).toBe(expected)
    })
    it('should return path to the configuration file for production', async () => {
      if (!window.electron) throw new Error('Electron not found')
      const expected = '/appData/zoo-modeling-app/envs/production.json'
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const actual = await getEnvironmentConfigurationPath(
        window.electron,
        'production'
      )
      mockElectron.packageJson.name = ''
      expect(actual).toBe(expected)
    })
  })

  describe('getEnvironmentPath', () => {
    it('should return a wonky path because appConfig is not set by default', async () => {
      if (!window.electron) throw new Error('Electron not found')
      const expected = '/appData//environment.txt'
      const actual = await getEnvironmentFilePath(window.electron)
      expect(actual).toBe(expected)
    })
    it('should return path to the environment.txt file', async () => {
      if (!window.electron) throw new Error('Electron not found')
      const expected = '/appData/zoo-modeling-app/environment.txt'
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const actual = await getEnvironmentFilePath(window.electron)
      mockElectron.packageJson.name = ''
      expect(actual).toBe(expected)
    })
  })

  describe('readEnvironmentConfigurationFile', () => {
    it('should return null for development', async () => {
      if (!window.electron) throw new Error('Electron not found')
      const expected = null
      const actual = await readEnvironmentConfigurationFile(
        window.electron,
        'dev.zoo.dev'
      )
      expect(actual).toBe(expected)
    })
    it('should return a empty string object for development', async () => {
      if (!window.electron) throw new Error('Electron not found')
      mockElectron.exists.mockImplementation(() => true)
      mockElectron.readFile.mockImplementation(() => {
        return '{"token":"","pool":"","domain":"dev.zoo.dev"}'
      })
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const expected: EnvironmentConfiguration = {
        domain: 'dev.zoo.dev',
        pool: '',
        token: '',
      }
      const actual = await readEnvironmentConfigurationFile(
        window.electron,
        'dev.zoo.dev'
      )

      // mock clean up
      mockElectron.packageJson.name = ''
      expect(actual).toStrictEqual(expected)
    })
    it('should return an empty string object for production', async () => {
      if (!window.electron) throw new Error('Electron not found')
      mockElectron.exists.mockImplementation(() => true)
      mockElectron.readFile.mockImplementation(() => {
        return '{"token":"","pool":"","domain":"zoo.dev"}'
      })
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const expected: EnvironmentConfiguration = {
        domain: 'zoo.dev',
        pool: '',
        token: '',
      }
      const actual = await readEnvironmentConfigurationFile(
        window.electron,
        'zoo.dev'
      )

      // mock clean up
      mockElectron.packageJson.name = ''
      expect(actual).toStrictEqual(expected)
    })
  })

  describe('readEnvironmentFile', () => {
    it('should return the empty string', async () => {
      if (!window.electron) throw new Error('Electron not found')
      const expected = ''
      const actual = await readEnvironmentFile(window.electron)
      expect(actual).toBe(expected)
    })
    it('should return development', async () => {
      if (!window.electron) throw new Error('Electron not found')
      const expected = 'dev.zoo.dev'
      mockElectron.exists.mockImplementation(() => true)
      mockElectron.readFile.mockImplementation(() => 'dev.zoo.dev')
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const actual = await readEnvironmentFile(window.electron)
      mockElectron.packageJson.name = ''
      expect(actual).toBe(expected)
    })
    it('should return production', async () => {
      if (!window.electron) throw new Error('Electron not found')
      const expected = 'zoo.dev'
      mockElectron.exists.mockImplementation(() => true)
      mockElectron.readFile.mockImplementation(() => 'zoo.dev')
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const actual = await readEnvironmentFile(window.electron)
      mockElectron.packageJson.name = ''
      expect(actual).toBe(expected)
    })
  })

  describe('readEnvironmentConfigurationToken', () => {
    it('should return the empty string for dev.zoo.dev', async () => {
      if (!window.electron) throw new Error('Electron not found')
      const expected = ''
      const actual = await readEnvironmentConfigurationToken(
        window.electron,
        'dev.zoo.dev'
      )
      expect(actual).toBe(expected)
    })
    it('should return the empty string for production', async () => {
      if (!window.electron) throw new Error('Electron not found')
      const expected = ''
      const actual = await readEnvironmentConfigurationToken(
        window.electron,
        'zoo.dev'
      )
      expect(actual).toBe(expected)
    })
    it('should return the string dog-dog-dog for development', async () => {
      if (!window.electron) throw new Error('Electron not found')
      mockElectron.exists.mockImplementation(() => true)
      mockElectron.readFile.mockImplementation(() => {
        return '{"token":"dog-dog-dog","pool":"","domain":"development"}'
      })
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const expected = 'dog-dog-dog'
      const actual = await readEnvironmentConfigurationToken(
        window.electron,
        'development'
      )
      // mock clean up
      mockElectron.packageJson.name = ''
      expect(actual).toBe(expected)
    })
    it('should return the string cat-cat-cat for production', async () => {
      if (!window.electron) throw new Error('Electron not found')
      mockElectron.exists.mockImplementation(() => true)
      mockElectron.readFile.mockImplementation(() => {
        return '{"token":"cat-cat-cat","pool":"","domain":"production"}'
      })
      mockElectron.packageJson.name = 'zoo-modeling-app'
      const expected = 'cat-cat-cat'
      const actual = await readEnvironmentConfigurationToken(
        window.electron,
        'production'
      )
      // mock clean up
      mockElectron.packageJson.name = ''
      expect(actual).toBe(expected)
    })
  })
})
