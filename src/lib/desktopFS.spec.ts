import { getNextFileName, getUniqueProjectName } from '@src/lib/desktopFS'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import fsZds from '@src/lib/fs-zds'
import type { FileEntry } from '@src/lib/project'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const wasmInstance = {
  relevant_file_extensions: () => ['kcl', 'stp', 'step'],
} as ModuleType

/** Create a dummy project */
function project(name: string, children?: FileEntry[]): FileEntry {
  return {
    name,
    children: children || [
      { name: 'main.kcl', children: null, path: 'main.kcl' },
    ],
    path: `/projects/${name}`,
  }
}

describe(`Getting unique project names`, () => {
  it(`should return the same name if no conflicts`, () => {
    const projectName = 'new-project'
    const projects = [project('existing-project'), project('another-project')]
    const result = getUniqueProjectName(projectName, projects)
    expect(result).toBe(projectName)
  })
  it(`should return a unique name if there is a conflict`, () => {
    const projectName = 'existing-project'
    const projects = [project('existing-project'), project('another-project')]
    const result = getUniqueProjectName(projectName, projects)
    expect(result).toBe('existing-project-1')
  })
  it(`should increment an ending index until a unique one is found`, () => {
    const projectName = 'existing-project-1'
    const projects = [
      project('existing-project'),
      project('existing-project-1'),
      project('existing-project-2'),
    ]
    const result = getUniqueProjectName(projectName, projects)
    expect(result).toBe('existing-project-3')
  })
  it(`should prefer the formatting of the index identifier if present`, () => {
    const projectName = 'existing-project-$nn'
    const projects = [
      project('existing-project'),
      project('existing-project-1'),
      project('existing-project-2'),
    ]
    const result = getUniqueProjectName(projectName, projects)
    expect(result).toBe('existing-project-03')
  })
  it(`be able to get an incrementing index regardless of padding zeroes`, () => {
    const projectName = 'existing-project-$nn'
    const projects = [
      project('existing-project'),
      project('existing-project-01'),
      project('existing-project-2'),
    ]
    const result = getUniqueProjectName(projectName, projects)
    expect(result).toBe('existing-project-03')
  })

  it('preserves non-KCL extensions when requested', async () => {
    const baseDir = `/tmp/opencode/desktopfs-${crypto.randomUUID()}`
    await fsZds.mkdir(baseDir, { recursive: true })

    try {
      await fsZds.writeFile(
        fsZds.join(baseDir, 'notes.pdf'),
        new TextEncoder().encode('a')
      )

      const nextFile = await getNextFileName({
        entryName: 'notes.pdf',
        baseDir,
        wasmInstance,
        preserveUnknownExtension: true,
      })

      expect(nextFile.name).toBe('notes-1.pdf')
    } finally {
      await fsZds.rm(baseDir, { recursive: true, force: true })
    }
  })

  it('rejects unexpected stat failures instead of selecting a file to overwrite', async () => {
    const error = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    })
    vi.spyOn(fsZds, 'stat').mockRejectedValue(error)

    await expect(
      getNextFileName({
        entryName: 'main.kcl',
        baseDir: '/projects/existing-project',
        wasmInstance,
      })
    ).rejects.toBe(error)
  })
})
