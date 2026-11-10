import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodefs from '@src/lib/fs-zds/nodefs'
import { fileSystemContract } from '@src/lib/fs-zds/testSupport/fileSystemContract'

fileSystemContract('NodeFS adapter properties (local disk)', async () => {
  const fs = nodefs.impl
  const root = await mkdtemp(fs.join(tmpdir(), 'zds-nodefs-contract-'))
  return {
    fs,
    root,
    dispose: () => fs.rm(root, { recursive: true, force: true }),
  }
})
