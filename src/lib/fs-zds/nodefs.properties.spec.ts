import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodefs from '@src/lib/fs-zds/nodefs'
import { fileSystemContract } from '@src/lib/fs-zds/testSupport/fileSystemContract'
import { expect, it } from 'vitest'

fileSystemContract('NodeFS adapter properties (local disk)', async () => {
  const fs = nodefs.impl
  const root = await mkdtemp(fs.join(tmpdir(), 'zds-nodefs-contract-'))
  return {
    fs,
    root,
    dispose: () => fs.rm(root, { recursive: true, force: true }),
  }
})

it('reads a regular file up to the exact byte limit', async () => {
  const fs = nodefs.impl
  const root = await mkdtemp(fs.join(tmpdir(), 'zds-nodefs-bounded-read-'))
  try {
    const path = fs.join(root, 'part.kcl')
    const bytes = new Uint8Array([1, 2, 3])
    await fs.writeFile(path, bytes)
    await expect(fs.readFileBounded?.(path, 3)).resolves.toEqual(bytes)
    await expect(fs.readFileBounded?.(path, 2)).rejects.toBe('EFBIG')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
