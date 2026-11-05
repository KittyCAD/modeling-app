import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import { projectFilesContract } from '@src/lib/fileSystem/testSupport/projectFilesContract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import nodefs from '@src/lib/fs-zds/nodefs'
import { beforeAll } from 'vitest'

beforeAll(() =>
  moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
)

projectFilesContract('project file collection on NodeFS', async () => {
  const fs = nodefs.impl
  const root = await mkdtemp(fs.join(tmpdir(), 'zds-project-files-'))
  const runtime = createFileOperationsRuntime(fs)
  return {
    fs,
    root,
    operations: runtime.operations,
    dispose: async () => {
      try {
        await runtime.dispose()
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    },
  }
})
