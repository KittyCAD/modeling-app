import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/browserSaveFile', () => ({
  browserSaveFile: vi.fn(
    async (_blob: Blob, _name: string, _toastId: string) => {}
  ),
}))

import { browserSaveFile } from '@src/lib/browserSaveFile'
import { exportSave } from '@src/lib/exportSave'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import JSZip from 'jszip'

describe('saving exported bytes', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('electron', undefined)
  })

  it('preserves a single binary file with typed bytes', async () => {
    const bytes = [0, 1, 127, 128, 254, 255]
    await exportSave({
      fileOperations: testFileOperations,
      files: [{ name: 'output.glb', contents: new Uint8Array(bytes) }],
      fileName: 'model.glb',
      toastId: 'export',
    })
    const [blob, name] = vi.mocked(browserSaveFile).mock.calls[0]
    expect(name).toBe('model.glb')
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual(bytes)
  })

  it('preserves mixed text and binary files in a ZIP', async () => {
    const text = new TextEncoder().encode('{"asset":{"version":"2.0"}}')
    const binary = new Uint8Array([0, 128, 255, 1])
    await exportSave({
      fileOperations: testFileOperations,
      files: [
        { name: 'model.gltf', contents: text },
        { name: 'model.bin', contents: binary },
      ],
      fileName: 'model',
      toastId: 'export',
    })
    const [blob, name] = vi.mocked(browserSaveFile).mock.calls[0]
    expect(name).toBe('model.zip')
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(await zip.file('model.gltf')?.async('string')).toBe(
      new TextDecoder().decode(text)
    )
    expect(await zip.file('model.bin')?.async('uint8array')).toEqual(binary)
  })
})
