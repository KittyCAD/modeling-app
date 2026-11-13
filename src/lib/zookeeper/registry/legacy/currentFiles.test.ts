import { encodeLegacyCurrentFiles } from '@src/lib/zookeeper/registry/legacy/currentFiles'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

describe('legacy Zookeeper current_files', () => {
  it('preserves nested paths and arbitrary binary contents', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array(), async (bytes) => {
        const code = '@settings(kclVersion = 3.0)\n// bracket\n'
        const files = await encodeLegacyCurrentFiles([
          { name: 'parts/main.kcl', data: new Blob([code]) },
          { name: 'assets/reference.bin', data: new Blob([bytes]) },
        ])
        expect(files).toEqual({
          'parts/main.kcl': Array.from(new TextEncoder().encode(code)),
          'assets/reference.bin': Array.from(bytes),
        })
      })
    )
  })
})
