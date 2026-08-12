import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { importProjectFilesIntoLocalDirectory } from '@src/lib/projectLibraries/operations'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

describe('importProjectFilesIntoLocalDirectory', () => {
  it('rejects project names outside the selected library', async () => {
    const testRoot = `/tmp/shared-project-import-${crypto.randomUUID()}`
    const projectDirectoryPath = fsZds.join(testRoot, 'library')
    await fsZds.mkdir(projectDirectoryPath, { recursive: true })

    try {
      await expect(
        importProjectFilesIntoLocalDirectory({
          projectDirectoryPath,
          requestedProjectName: '..',
          requestedProjectTitle: 'Unsafe project',
          files: [
            {
              requestedFileName: 'main.kcl',
              requestedData: new TextEncoder().encode('x = 1\n'),
            },
          ],
          entrypointFilePath: 'main.kcl',
          wasmInstancePromise: {} as ModuleType,
        })
      ).rejects.toThrow('invalid project directory name')

      await expect(
        fsZds.stat(fsZds.join(testRoot, 'main.kcl'))
      ).rejects.toBeDefined()
      await expect(fsZds.readdir(projectDirectoryPath)).resolves.toEqual([])
    } finally {
      await fsZds.rm(testRoot, { recursive: true, force: true })
    }
  })
})
