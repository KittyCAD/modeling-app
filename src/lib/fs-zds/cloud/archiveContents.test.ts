import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { readProjectZip } from '@src/lib/fs-zds/cloud/archiveContents'

describe('project ZIP boundaries', () => {
  it.each([0, 1, 3, 21])(
    'rejects a truncated %i-byte header without a range error',
    async (length) => {
      await expect(readProjectZip(new ArrayBuffer(length))).rejects.toThrow(
        'not a valid ZIP'
      )
    }
  )

  it('rejects duplicate central-directory names even when the local headers differ', async () => {
    const zip = new JSZip()
    zip.file('a.kcl', 'first')
    zip.file('b.kcl', 'second')
    const archive = await zip.generateAsync({ type: 'arraybuffer' })
    const view = new DataView(archive)
    const bytes = new Uint8Array(archive)
    for (let offset = 0; offset + 46 <= archive.byteLength; offset++) {
      if (
        view.getUint32(offset, true) === 0x02014b50 &&
        bytes[offset + 46] === 'b'.charCodeAt(0)
      ) {
        bytes[offset + 46] = 'a'.charCodeAt(0)
        break
      }
    }
    await expect(readProjectZip(archive)).rejects.toThrow('duplicate')
  })

  it.each([
    '../main.kcl',
    '/main.kcl',
    'C:/main.kcl',
    'parts/../main.kcl',
    'parts\\main.kcl',
  ])(
    'rejects unsafe original path %s before normalization can hide it',
    async (name) => {
      const zip = new JSZip()
      zip.file('main.kcl', 'original')
      zip.file(name, 'replacement')
      await expect(
        readProjectZip(await zip.generateAsync({ type: 'arraybuffer' }))
      ).rejects.toThrow(/unsafe/)
    }
  )

  it('rejects traversal even when a later safe entry hides the normalized collision', async () => {
    const zip = new JSZip()
    zip.file('../main.kcl', 'replacement')
    zip.file('main.kcl', 'original')
    await expect(
      readProjectZip(await zip.generateAsync({ type: 'arraybuffer' }))
    ).rejects.toThrow(/unsafe/)
  })

  it('rejects too many entries before decompression', async () => {
    const zip = new JSZip()
    zip.file('a.kcl', 'a')
    zip.file('b.kcl', 'b')
    await expect(
      readProjectZip(await zip.generateAsync({ type: 'arraybuffer' }), {
        maxEntries: 1,
        maxBytes: 1024,
      })
    ).rejects.toThrow(/file count/)
  })

  it('rejects a small compressed archive with an excessive expanded size', async () => {
    const zip = new JSZip()
    zip.file('main.kcl', 'x'.repeat(64 * 1024))
    const archive = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
    })
    expect(archive.byteLength).toBeLessThan(1024)
    await expect(
      readProjectZip(archive, { maxEntries: 10, maxBytes: 1024 })
    ).rejects.toThrow(/size/)
  })

  it('enforces the byte budget while inflating even if the declared size lies', async () => {
    const zip = new JSZip()
    zip.file('main.kcl', 'x'.repeat(64 * 1024))
    const archive = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
    })
    const view = new DataView(archive)
    for (let offset = 0; offset + 46 <= archive.byteLength; offset++)
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 1, true)
        break
      }
    await expect(
      readProjectZip(archive, { maxEntries: 10, maxBytes: 1024 })
    ).rejects.toThrow(/size/)
  })

  it('rejects Unix symlinks instead of importing them as files', async () => {
    const zip = new JSZip()
    zip.file('linked.kcl', '../outside.kcl', { unixPermissions: 0o120777 })
    await expect(
      readProjectZip(
        await zip.generateAsync({ type: 'arraybuffer', platform: 'UNIX' })
      )
    ).rejects.toThrow(/symbolic link/)
  })

  it('keeps nested Unicode filenames and binary bytes under the limits', async () => {
    const zip = new JSZip()
    zip.file('parts/café.kcl', new Uint8Array([0, 128, 255]))
    expect(
      await readProjectZip(await zip.generateAsync({ type: 'arraybuffer' }))
    ).toEqual([
      { relativePath: 'parts/café.kcl', data: new Uint8Array([0, 128, 255]) },
    ])
  })
})
