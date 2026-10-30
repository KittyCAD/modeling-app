import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

vi.mock('@src/lib/desktop', () => ({ writeProjectThumbnailFile: vi.fn() }))

import { createProjectThumbnail } from '@src/lib/screenshot'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('delayed project thumbnails', () => {
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
