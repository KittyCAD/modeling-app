import { exportSave } from '@src/lib/exportSave'
import { dataUrlToFile, takeViewportScreenshot } from '@src/lib/screenshot'
import { isErr } from '@src/lib/trap'
import toast from 'react-hot-toast'

export const VIEWPORT_SCREENSHOT_FILE_NAME = 'viewport-screenshot.png'

export async function saveViewportScreenshot(): Promise<void> {
  let screenshotFile: File | Error
  try {
    const dataUrl = takeViewportScreenshot()
    if (!dataUrl) {
      toast.error(
        'Screenshot unavailable because the modeling viewport is not ready.'
      )
      return
    }
    screenshotFile = dataUrlToFile(dataUrl, VIEWPORT_SCREENSHOT_FILE_NAME)
  } catch (error) {
    console.error('Failed to capture viewport screenshot', error)
    toast.error('Failed to capture viewport screenshot.')
    return
  }

  if (isErr(screenshotFile)) {
    toast.error(screenshotFile.message)
    return
  }

  const toastId = toast.loading('Saving screenshot...')
  try {
    const contents = Array.from(
      new Uint8Array(await screenshotFile.arrayBuffer())
    )
    await exportSave({
      files: [{ name: VIEWPORT_SCREENSHOT_FILE_NAME, contents }],
      fileName: VIEWPORT_SCREENSHOT_FILE_NAME,
      toastId,
    })
  } catch (error) {
    console.error('Failed to save viewport screenshot', error)
    toast.error('Failed to save screenshot.', { id: toastId })
  }
}
