import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import nodefs from '@src/lib/fs-zds/nodefs'
import { fileSystemContract } from '@src/lib/fs-zds/testSupport/fileSystemContract'

fileSystemContract('MemoryFS adapter properties (no disk I/O)', async () => {
  const fs = createMemoryFileSystem(nodefs.impl)
  const root = fs.resolve('/memory-contract', crypto.randomUUID())
  await fs.mkdir(root, { recursive: true })
  return {
    fs,
    root,
    dispose: () => fs.rm(root, { recursive: true, force: true }),
  }
})
