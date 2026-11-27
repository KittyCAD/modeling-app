import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  ProjectArchiveLimitError,
  PROJECT_ARCHIVE_LIMITS,
  readProjectZip,
  validateProjectUpload,
} from '@src/lib/cloudProjects/runtime/archiveContents'

describe('project ZIP boundaries', () => {
  it('names the compressed byte limit and gives a recovery action', async () => {
    const zip = new JSZip()
    zip.file('main.kcl', 'cube()')
    const archive = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(
      readProjectZip(archive, {
        maxEntries: 10,
        maxBytes: archive.byteLength - 1,
      })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/size limit.*Reduce.*support/),
      limit: 'bytes',
    })
  })

  it('keeps unsupported multi-disk ZIPs distinct from file count limits', async () => {
    const zip = new JSZip()
    zip.file('main.kcl', '')
    const archive = await zip.generateAsync({ type: 'arraybuffer' })
    new DataView(archive).setUint16(archive.byteLength - 22 + 4, 1, true)
    await expect(readProjectZip(archive)).rejects.toThrow(/format/)
    await expect(readProjectZip(archive)).rejects.not.toBeInstanceOf(
      ProjectArchiveLimitError
    )
  })

  it('supports the agreed 1 GiB and 10,000-entry project budget', () => {
    expect(PROJECT_ARCHIVE_LIMITS).toEqual({
      maxBytes: 1024 * 1024 * 1024,
      maxEntries: 10_000,
    })
  })

  it('accepts an archive at the compressed byte limit and rejects one byte over', async () => {
    const zip = new JSZip()
    zip.file('main.kcl', 'cube()')
    const archive = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(
      readProjectZip(archive, { maxEntries: 1, maxBytes: archive.byteLength })
    ).resolves.toEqual([
      { relativePath: 'main.kcl', data: new TextEncoder().encode('cube()') },
    ])
    await expect(
      readProjectZip(archive, {
        maxEntries: 1,
        maxBytes: archive.byteLength - 1,
      })
    ).rejects.toThrow(/size/)
  })

  it('counts expanded bytes across files and accepts exactly the byte budget', async () => {
    const zip = new JSZip()
    zip.file('a.kcl', 'a'.repeat(1024))
    zip.file('b.kcl', 'b'.repeat(1024))
    const archive = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
    })
    expect(archive.byteLength).toBeLessThan(2047)
    await expect(
      readProjectZip(archive, { maxEntries: 2, maxBytes: 2048 })
    ).resolves.toEqual([
      {
        relativePath: 'a.kcl',
        data: new TextEncoder().encode('a'.repeat(1024)),
      },
      {
        relativePath: 'b.kcl',
        data: new TextEncoder().encode('b'.repeat(1024)),
      },
    ])
    await expect(
      readProjectZip(archive, { maxEntries: 2, maxBytes: 2047 })
    ).rejects.toThrow(/size/)
  })

  it('accepts 10,000 entries and rejects the next entry', async () => {
    const zip = new JSZip()
    for (let i = 0; i < 10_000; i++) zip.file(`${i}.kcl`, '')
    const archive = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(readProjectZip(archive)).resolves.toHaveLength(10_000)
    zip.file('extra.kcl', '')
    await expect(
      readProjectZip(await zip.generateAsync({ type: 'arraybuffer' }))
    ).rejects.toThrow(/file count/)
  })

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

describe('project upload boundaries', () => {
  it('accepts exactly 1 GiB of file contents and rejects one byte more', () => {
    const data = new Uint8Array(1024 * 1024)
    const files = Array.from({ length: 1024 }, (_, i) => ({
      relativePath: `${i}.bin`,
      data,
    }))
    expect(validateProjectUpload(files)).toBeUndefined()
    expect(
      validateProjectUpload([
        ...files,
        { relativePath: 'extra.bin', data: new Uint8Array(1) },
      ])
    ).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/size/) })
    )
  })

  it('accepts 10,000 files and rejects one more, including empty files', () => {
    const files = Array.from({ length: 10_000 }, (_, i) => ({
      relativePath: `${i}.kcl`,
      data: new Uint8Array(),
    }))
    expect(validateProjectUpload(files)).toBeUndefined()
    expect(
      validateProjectUpload([
        ...files,
        { relativePath: 'extra.kcl', data: new Uint8Array() },
      ])
    ).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/file count/) })
    )
  })
})
