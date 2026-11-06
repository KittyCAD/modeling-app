import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import { projectFilesContract } from '@src/lib/fileSystem/testSupport/projectFilesContract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import nodefs from '@src/lib/fs-zds/nodefs'
import { beforeAll } from 'vitest'

// The collector uses process-wide path helpers; its I/O uses the memory fixture.
beforeAll(() =>
  moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
)

projectFilesContract('project file collection on MemoryFS', async () => {
  const fs = createMemoryFileSystem(nodefs.impl)
  const root = fs.resolve('/project-files-contract', crypto.randomUUID())
  await fs.mkdir(root, { recursive: true })
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
