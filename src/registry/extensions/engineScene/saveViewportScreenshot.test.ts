import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dataUrlToFile, exportSave, takeViewportScreenshot, toast } = vi.hoisted(
  () => ({
    dataUrlToFile: vi.fn(),
    exportSave: vi.fn(),
    takeViewportScreenshot: vi.fn(),
    toast: {
      error: vi.fn(),
      loading: vi.fn(() => 'screenshot-toast'),
    },
  })
)

vi.mock('@src/lib/exportSave', () => ({ exportSave }))
vi.mock('@src/lib/screenshot', () => ({
  dataUrlToFile,
  takeViewportScreenshot,
}))
vi.mock('react-hot-toast', () => ({ default: toast }))

import {
  saveViewportScreenshot,
  VIEWPORT_SCREENSHOT_FILE_NAME,
} from './saveViewportScreenshot'

describe('saveViewportScreenshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports when the modeling viewport is unavailable', async () => {
    takeViewportScreenshot.mockReturnValue('')

    await saveViewportScreenshot()

    expect(toast.error).toHaveBeenCalledWith(
      'Screenshot unavailable because the modeling viewport is not ready.'
    )
    expect(exportSave).not.toHaveBeenCalled()
  })

  it('saves the viewport as a PNG', async () => {
    const pngDataUrl = 'data:image/png;base64,c2NyZWVuc2hvdA=='
    takeViewportScreenshot.mockReturnValue(pngDataUrl)
    dataUrlToFile.mockReturnValue(
      new File(['screenshot'], VIEWPORT_SCREENSHOT_FILE_NAME, {
        type: 'image/png',
      })
    )

    await saveViewportScreenshot()

    expect(dataUrlToFile).toHaveBeenCalledWith(
      pngDataUrl,
      VIEWPORT_SCREENSHOT_FILE_NAME
    )
    expect(exportSave).toHaveBeenCalledWith({
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
