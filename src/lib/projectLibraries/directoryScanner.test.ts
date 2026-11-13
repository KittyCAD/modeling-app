import { posix } from '@chainner/node-path'
import { getProjectInfo } from '@src/lib/desktop'
import { FileNotFound } from '@src/lib/fileSystem/fileOperations'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import { readProjectsFromProjectDirectory } from '@src/lib/projectLibraries/directoryScanner'
import { createProjectForTest } from '@src/lib/projectTestUtils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', () => ({ default: posix }))
// Metadata parsing and permission discovery have their own integration coverage.
vi.mock('@src/lib/desktop', () => ({
  getProjectInfo: vi.fn(),
  canReadWriteDirectory: async () => ({ value: true }),
  mkdirOrNOOP: async () => {},
  isPathNotFoundError: (error: unknown) => error instanceof FileNotFound,
}))

let memory: ReturnType<typeof createMemoryFileSystem>
let runtime: ReturnType<typeof createFileOperationsRuntime>
beforeEach(async () => {
  vi.mocked(getProjectInfo).mockReset()
  memory = createMemoryFileSystem({ ...noopfs.impl, ...posix })
  await memory.mkdir('/projects', { recursive: true })
  runtime = createFileOperationsRuntime(memory)
})
afterEach(async () => {
  await runtime.dispose()
})

const wasmInstancePromise = Promise.resolve({} as ModuleType)

describe('directory project scanner', () => {
  it('aggregates permission failures while ignoring projects removed during discovery', async () => {
    for (const name of ['missing', 'blocked-one', 'blocked-two'])
      await memory.mkdir(`/projects/${name}`)
    const failure = Object.assign(new Error('Permission denied'), {
      code: 'EACCES',
    })
    const stat = runtime.operations.stat
    const onProjectStatFailures = vi.fn()
    const projects = await readProjectsFromProjectDirectory({
      fileOperations: {
        ...runtime.operations,
        stat: async (path) => {
          if (path === '/projects/missing') {
            await memory.rm(path, { recursive: true })
            return stat(path)
          }
          throw failure
        },
      },
      projectDirectoryPath: '/projects',
      wasmInstancePromise,
      onProjectStatFailures,
    })
    expect(projects).toEqual([])
    expect(onProjectStatFailures).toHaveBeenCalledExactlyOnceWith({
      error: failure,
      count: 2,
    })
    expect(getProjectInfo).not.toHaveBeenCalled()
  })

  it('lists projects without moving directories to match their titles', async () => {
    await memory.mkdir('/projects/stale-id')
    await memory.writeFile('/projects/stale-id/main.kcl', new Uint8Array([42]))
    const project = createProjectForTest('/projects/stale-id', {
      title: 'My Cool Project',
      kcl_file_count: 1,
    })
    vi.mocked(getProjectInfo).mockResolvedValue(project)
    const projects = await readProjectsFromProjectDirectory({
      fileOperations: runtime.operations,
      projectDirectoryPath: '/projects',
      wasmInstancePromise,
    })
    expect(projects).toEqual([project])
    expect(await memory.readdir('/projects')).toEqual(['stale-id'])
    expect(await memory.readdir('/projects/stale-id')).toEqual(['main.kcl'])
    expect(await memory.readFile('/projects/stale-id/main.kcl')).toEqual(
      new Uint8Array([42])
    )
  })
})
