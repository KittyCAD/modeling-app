import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  createFileOperationsScheduler,
  type FileOperationsScheduler,
} from '@src/lib/fileSystem/scheduler'
import { createProjectOperations } from '@src/lib/fileSystem/projectOperations'
import { collectProjectFilesForUpload } from '@src/lib/fileSystem/projectFiles'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import nodefs from '@src/lib/fs-zds/nodefs'

beforeAll(() =>
  moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
)

describe.skipIf(process.platform === 'win32')(
  'project symlink boundaries on disk',
  () => {
    let root: string
    let project: string
    let outside: string
    let runtime: FileOperationsScheduler
    beforeEach(async () => {
      root = await fs.mkdtemp(nodefs.impl.join(tmpdir(), 'zds-project-links-'))
      project = nodefs.impl.join(root, 'project')
      outside = nodefs.impl.join(root, 'outside')
      await fs.mkdir(project)
      await fs.mkdir(outside)
      await fs.writeFile(
        nodefs.impl.join(outside, 'private.kcl'),
        'outside sentinel'
      )
      await fs.symlink(outside, nodefs.impl.join(project, 'linked'))
      await fs.symlink(
        nodefs.impl.join(outside, 'private.kcl'),
        nodefs.impl.join(project, 'linked.kcl')
      )
      runtime = createFileOperationsScheduler(nodefs.impl)
    })
    afterEach(async () => {
      try {
        await runtime?.dispose()
      } finally {
        if (root) await fs.rm(root, { recursive: true, force: true })
      }
    })

    it.each(['linked/private.kcl', 'linked.kcl'])(
      'rejects overwrite and deletion through %s',
      async (relative) => {
        const operations = createProjectOperations({
          operations: runtime.operations,
          wasm: vi.fn(),
        })
        await expect(
          operations.writeFiles(
            project,
            [{ path: relative, contents: 'bad' }],
            { overwrite: true }
          )
        ).rejects.toThrow('symbolic links')
        await expect(
          operations.applyEdits(project, [
            { path: nodefs.impl.join(project, relative), contents: null },
          ])
        ).rejects.toThrow('symbolic links')
        expect(
          await fs.readFile(nodefs.impl.join(outside, 'private.kcl'), 'utf8')
        ).toBe('outside sentinel')
      }
    )

    it('validates every path before applying an earlier valid edit', async () => {
      const operations = createProjectOperations({
        operations: runtime.operations,
        wasm: vi.fn(),
      })
      const ordinary = nodefs.impl.join(project, 'ordinary.kcl')
      await fs.writeFile(ordinary, 'keep')
      await expect(
        operations.applyEdits(project, [
          { path: ordinary, contents: 'bad' },
          {
            path: nodefs.impl.join(project, 'linked/private.kcl'),
            contents: 'bad',
          },
        ])
      ).rejects.toThrow('symbolic links')
      expect(await fs.readFile(ordinary, 'utf8')).toBe('keep')
    })

    it('refuses upload collection through symlinks', async () => {
      await expect(
        collectProjectFilesForUpload({
          fileOperations: runtime.operations,
          projectRoot: project,
        })
      ).rejects.toThrow('symbolic links')
    })

    it('still permits ordinary nested project writes and deletes', async () => {
      const operations = createProjectOperations({
        operations: runtime.operations,
        wasm: vi.fn(),
      })
      const file = nodefs.impl.join(project, 'nested', 'safe.kcl')
      await operations.applyEdits(project, [{ path: file, contents: 'safe' }])
      expect(await fs.readFile(file, 'utf8')).toBe('safe')
      await operations.applyEdits(project, [{ path: file, contents: null }])
      await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  }
)
