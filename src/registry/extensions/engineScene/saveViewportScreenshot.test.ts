import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dataUrlToFile, exportSave, capture, toast } = vi.hoisted(() => ({
  dataUrlToFile: vi.fn(),
  exportSave: vi.fn(),
  capture: vi.fn(),
  toast: {
    error: vi.fn(),
    loading: vi.fn(() => 'screenshot-toast'),
  },
}))

vi.mock('@src/lib/exportSave', () => ({ exportSave }))
vi.mock('@src/lib/screenshot', () => ({ dataUrlToFile }))
vi.mock('react-hot-toast', () => ({ default: toast }))

import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import {
  saveViewportScreenshot,
  VIEWPORT_SCREENSHOT_FILE_NAME,
} from './saveViewportScreenshot'

describe('saveViewportScreenshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports when the modeling viewport is unavailable', async () => {
    capture.mockReturnValue('')

    await saveViewportScreenshot(testFileOperations, { capture })

    expect(toast.error).toHaveBeenCalledWith(
      'Screenshot unavailable because the modeling viewport is not ready.'
    )
    expect(exportSave).not.toHaveBeenCalled()
  })

  it('saves the viewport as a PNG', async () => {
    const pngDataUrl = 'data:image/png;base64,c2NyZWVuc2hvdA=='
    capture.mockReturnValue(pngDataUrl)
    dataUrlToFile.mockReturnValue(
      new File(['screenshot'], VIEWPORT_SCREENSHOT_FILE_NAME, {
        type: 'image/png',
      })
    )

    await saveViewportScreenshot(testFileOperations, { capture })

    expect(dataUrlToFile).toHaveBeenCalledWith(
      pngDataUrl,
      VIEWPORT_SCREENSHOT_FILE_NAME
    )
    expect(exportSave).toHaveBeenCalledWith({
      fileOperations: testFileOperations,
      files: [
        {
          name: VIEWPORT_SCREENSHOT_FILE_NAME,
          contents: Array.from(new TextEncoder().encode('screenshot')),
        },
      ],
      fileName: VIEWPORT_SCREENSHOT_FILE_NAME,
      toastId: 'screenshot-toast',
    })
  })
})
