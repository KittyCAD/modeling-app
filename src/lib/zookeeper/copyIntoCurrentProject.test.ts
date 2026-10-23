import {
  copyLibraryFilesIntoCurrentProject,
  CurrentProjectCopyError,
} from '@src/lib/zookeeper/copyIntoCurrentProject'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const root = '/projects/current'
const mainPath = `${root}/main.kcl`
const blankMain = '@settings(kclVersion = 3.0)\n'
const sourceMain =
  '@settings(kclVersion = 1.0)\nimport "parts/wheel.kcl" as wheel\n'
const encode = (value: string) => new TextEncoder().encode(value)

function fixture() {
  const stored = new Map<string, Uint8Array>([
    [mainPath, encode(blankMain)],
    [`${root}/project.toml`, encode('title = "Current"\n')],
  ])
  const directories = new Set([root])
  let editorCode = blankMain
  const fileOperations = {
    realpath: vi.fn(async (path: string) => path),
    readFile: vi.fn(async (path: string) => {
      const data = stored.get(path)
      if (!data) {
        return Promise.reject(new Error('Missing file'))
      }
      return data
    }),
    readDirectory: vi.fn(async (path: string) =>
      path === root
        ? ['main.kcl', 'project.toml', 'thumbnail.png', '.gitignore']
        : []
    ),
    exists: vi.fn(
      async (path: string) => directories.has(path) || stored.has(path)
    ),
    createDirectory: vi.fn(async (path: string) => {
      directories.add(path)
    }),
    createFile: vi.fn(async (path: string, data: Uint8Array) => {
      if (stored.has(path)) {
        return Promise.reject(new Error('File exists'))
      }
      stored.set(path, data)
    }),
    writeFile: vi.fn(async (path: string, data: string | Uint8Array) => {
      stored.set(path, typeof data === 'string' ? encode(data) : data)
    }),
    remove: vi.fn(async (path: string) => {
      stored.delete(path)
      directories.delete(path)
    }),
  }
  const kclManager = {
    path: mainPath,
    get code() {
      return editorCode
    },
    flushWriteToFile: vi.fn(async () => {
      stored.set(mainPath, encode(editorCode))
      return true
    }),
    updateCodeEditor: vi.fn((code: string) => {
      editorCode = code
    }),
  }
  const project = {
    path: root,
    name: 'current',
    projectIORefSignal: { value: { title: 'Current' } },
    syncReplayedFilesToRust: vi.fn(async () => {}),
  }
  const args = {
    fileOperations: fileOperations as unknown as Parameters<
      typeof copyLibraryFilesIntoCurrentProject
    >[0]['fileOperations'],
    project: project as unknown as Parameters<
      typeof copyLibraryFilesIntoCurrentProject
    >[0]['project'],
    kclManager: kclManager as unknown as Parameters<
      typeof copyLibraryFilesIntoCurrentProject
    >[0]['kclManager'],
    isCurrent: () => true,
    sourceTitle: 'Wall-E',
    sourcePath: '/projects/wall-e',
    files: [
      { path: 'main.kcl', data: encode(sourceMain) },
      { path: 'parts/wheel.kcl', data: encode('wheel = 1\n') },
    ],
  }
  return { args, directories, fileOperations, kclManager, project, stored }
}

describe('copy library files into the current project', () => {
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })

  it('copies into a blank project and refreshes its editor while keeping its identity', async () => {
    const { args, fileOperations, kclManager, project, stored } = fixture()
    const result = await copyLibraryFilesIntoCurrentProject(args)

    expect(result).toEqual({
      title: 'Current',
      source_title: 'Wall-E',
      destination: 'current_project',
    })
    expect(new TextDecoder().decode(stored.get(mainPath))).toBe(sourceMain)
    expect(
      new TextDecoder().decode(stored.get(`${root}/parts/wheel.kcl`))
    ).toBe('wheel = 1\n')
    expect(new TextDecoder().decode(stored.get(`${root}/project.toml`))).toBe(
      'title = "Current"\n'
    )
    expect(project.syncReplayedFilesToRust).toHaveBeenCalledWith([
      { absolutePath: `${root}/parts/wheel.kcl`, nextContent: 'wheel = 1\n' },
    ])
    expect(kclManager.updateCodeEditor).toHaveBeenCalledWith(
      sourceMain,
      expect.objectContaining({ shouldExecute: true, shouldWriteToDisk: true })
    )
    expect(fileOperations.createFile).toHaveBeenCalledOnce()
  })

  it('rejects a nonblank target before writing any source files', async () => {
    const { args, fileOperations, kclManager } = fixture()
    kclManager.updateCodeEditor('existingBody = 1\n')

    await expect(
      copyLibraryFilesIntoCurrentProject(args)
    ).rejects.toBeInstanceOf(CurrentProjectCopyError)
    expect(fileOperations.createFile).not.toHaveBeenCalled()
  })

  it('removes newly created files and directories after a write failure', async () => {
    const { args, directories, fileOperations, stored } = fixture()
    args.files.push({ path: 'parts/axle.kcl', data: encode('axle = 1\n') })
    fileOperations.createFile.mockImplementationOnce(async (path, data) => {
      stored.set(path, data)
    })
    fileOperations.createFile.mockRejectedValueOnce(new Error('Disk full'))

    await expect(copyLibraryFilesIntoCurrentProject(args)).rejects.toThrow(
      'Could not copy files into the current project.'
    )
    expect(stored.has(`${root}/parts/wheel.kcl`)).toBe(false)
    expect(directories.has(`${root}/parts`)).toBe(false)
    expect(new TextDecoder().decode(stored.get(mainPath))).toBe(blankMain)
  })

  it('restores disk files if the project switches while the main file is saved', async () => {
    const { args, fileOperations, kclManager, stored } = fixture()
    let current = true
    args.isCurrent = () => current
    kclManager.flushWriteToFile.mockImplementationOnce(async () => true)
    kclManager.flushWriteToFile.mockImplementationOnce(async () => {
      stored.set(mainPath, encode(sourceMain))
      current = false
      return true
    })

    await expect(
      copyLibraryFilesIntoCurrentProject(args)
    ).rejects.toBeInstanceOf(CurrentProjectCopyError)
    expect(new TextDecoder().decode(stored.get(mainPath))).toBe(blankMain)
    expect(stored.has(`${root}/parts/wheel.kcl`)).toBe(false)
    expect(fileOperations.writeFile).toHaveBeenCalledWith(mainPath, blankMain)
  })
})
