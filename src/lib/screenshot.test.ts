import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

vi.mock('@src/lib/desktop', () => ({ writeProjectThumbnailFile: vi.fn() }))

import { createProjectThumbnail } from '@src/lib/screenshot'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('delayed project thumbnails', () => {
  it.each([false, true])(
    'copies the local frame immediately and only saves a current thumbnail (changed during encoding: %s)',
    async (changed) => {
      vi.useFakeTimers()
      let current = true
      let finishEncoding: BlobCallback | undefined
      const frame = document.createElement('canvas')
      frame.width = 40
      frame.height = 30
      vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 40, 30)
      )
      const drawImage = vi.fn()
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage,
      } as unknown as CanvasRenderingContext2D)
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
        (callback) => {
          finishEncoding = callback
        }
      )
      const writeThumbnail = vi.fn(async () => {})
      createProjectThumbnail({
        fileOperations: {} as FileOperationsRegistryService,
        projectDirectoryWithoutEndingSlash: '/project',
        renderedCanvas: frame,
        isCurrent: () => current,
        writeThumbnail,
      })
      expect(drawImage).toHaveBeenCalledWith(frame, 0, 0, 40, 30)
      expect(finishEncoding).toEqual(expect.any(Function))
      expect(writeThumbnail).not.toHaveBeenCalled()
      current = !changed
      const bytes = new Uint8Array([0, 128, 255])
      finishEncoding?.({ arrayBuffer: async () => bytes.buffer } as Blob)
      await vi.advanceTimersByTimeAsync(0)
      if (changed) expect(writeThumbnail).not.toHaveBeenCalled()
      else expect(writeThumbnail).toHaveBeenCalledWith('/project', bytes)
    }
  )

  it.each(['before scheduling', 'before capture'])(
    'skips capture when the entrypoint is no longer current %s',
    async (when) => {
      vi.useFakeTimers()
      let current = when !== 'before scheduling'
      const query = vi.spyOn(document, 'querySelector')
      const writeThumbnail = vi.fn(async () => {})
      createProjectThumbnail({
        fileOperations: {} as FileOperationsRegistryService,
        projectDirectoryWithoutEndingSlash: '/project',
        isCurrent: () => current,
        writeThumbnail,
      })
      current = false
      await vi.advanceTimersByTimeAsync(500)
      expect(query).not.toHaveBeenCalled()
      expect(writeThumbnail).not.toHaveBeenCalled()
    }
  )
})
