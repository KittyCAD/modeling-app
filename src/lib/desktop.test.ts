import { vi, describe, it, expect, beforeEach } from 'vitest'
import { listProjects } from './desktop'
import { DeepPartial } from './types'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'

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

  const mockFileSystem: { [key: string]: string[] } = {
    '/test/projects': [
      '.hidden-project',
      'valid-project',
      '.git',
      'project-without-kcl-files',
      'another-valid-project',
    ],
    '/test/projects/valid-project': ['file1.kcl', 'file2.stp'],
    '/test/projects/project-without-kcl-files': ['file3.glb'],
    '/test/projects/another-valid-project': ['file4.kcl'],
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup default mock implementations
    mockElectron.path.join.mockImplementation((...parts: string[]) =>
      parts.join('/')
    )
    mockElectron.path.basename.mockImplementation((path: string) =>
      path.split('/').pop()
    )
    mockElectron.path.dirname.mockImplementation((path: string) =>
      path.split('/').slice(0, -1).join('/')
    )

    // Mock readdir to return the entries for the given path
    mockElectron.readdir.mockImplementation(async (path: string) => {
      return mockFileSystem[path] || []
    })

    // Mock statIsDirectory to return true if the path exists in mockFileSystem
    mockElectron.statIsDirectory.mockImplementation(async (path: string) => {
      return path in mockFileSystem
    })

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
      const projects = await listProjects(mockConfig)
      expect(projects.map((p) => p.name)).not.toContain('.git')
    })
    it('lists projects excluding hidden and without .kcl files', async () => {
      const projects = await listProjects(mockConfig)

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

    it('handles empty project directory', async () => {
      // Adjust mockFileSystem to simulate empty directory
      mockFileSystem['/test/projects'] = []

      const projects = await listProjects(mockConfig)

      expect(projects).toEqual([])
    })
  })
})
