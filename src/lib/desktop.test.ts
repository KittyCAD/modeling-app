import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'

import { isRelevantFile, listProjects } from '@src/lib/desktop'
import type { DeepPartial } from '@src/lib/types'

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

  describe('isRelevantFile', () => {
    it('finds supported extension files relevant', () => {
      expect(isRelevantFile('part.kcl')).toEqual(true)
      expect(isRelevantFile('part.fbx')).toEqual(true)
      expect(isRelevantFile('part.gltf')).toEqual(true)
      expect(isRelevantFile('part.glb')).toEqual(true)
      expect(isRelevantFile('part.obj')).toEqual(true)
      expect(isRelevantFile('part.ply')).toEqual(true)
      expect(isRelevantFile('part.sldprt')).toEqual(true)
      expect(isRelevantFile('part.stp')).toEqual(true)
      expect(isRelevantFile('part.step')).toEqual(true)
      expect(isRelevantFile('part.stl')).toEqual(true)
    })

    // TODO: we should be lowercasing the extension here to check. .sldprt or .SLDPRT should be supported
    // But the api doesn't allow it today, so revisit this and the tests once this is done
    it('finds (now) supported uppercase extension files *not* relevant', () => {
      expect(isRelevantFile('part.KCL')).toEqual(false)
      expect(isRelevantFile('part.FBX')).toEqual(false)
      expect(isRelevantFile('part.GLTF')).toEqual(false)
      expect(isRelevantFile('part.GLB')).toEqual(false)
      expect(isRelevantFile('part.OBJ')).toEqual(false)
      expect(isRelevantFile('part.PLY')).toEqual(false)
      expect(isRelevantFile('part.SLDPRT')).toEqual(false)
      expect(isRelevantFile('part.STP')).toEqual(false)
      expect(isRelevantFile('part.STEP')).toEqual(false)
      expect(isRelevantFile('part.STL')).toEqual(false)
    })

    it("doesn't find .docx or .SLDASM relevant", () => {
      expect(isRelevantFile('paper.docx')).toEqual(false)
      expect(isRelevantFile('assembly.SLDASM')).toEqual(false)
    })
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

    it('correctly counts directories and files', async () => {
      const projects = await listProjects(mockConfig)
      // Verify that directories and files are counted correctly
      expect(projects[0].directory_count).toEqual(1)
      expect(projects[0].kcl_file_count).toEqual(2)
      expect(projects[1].directory_count).toEqual(2)
      expect(projects[1].kcl_file_count).toEqual(1)
    })

    it('handles empty project directory', async () => {
      // Adjust mockFileSystem to simulate empty directory
      mockFileSystem['/test/projects'] = []

      const projects = await listProjects(mockConfig)

      expect(projects).toEqual([])
    })
  })
})
