import {
  getProjectThumbnailsPath,
  writeProjectThumbnailFile,
} from '@src/lib/desktop'
import { PROJECT_IMAGE_NAME } from '@src/lib/constants'

export function takeScreenshotOfVideoStreamCanvas() {
  const canvas = document.querySelector('[data-engine]')
  const video = document.getElementById('video-stream')
  if (
    canvas &&
    video &&
    canvas instanceof HTMLCanvasElement &&
    video instanceof HTMLVideoElement
  ) {
    const videoCanvas = document.createElement('canvas')
    videoCanvas.width = canvas.width
    videoCanvas.height = canvas.height
    const context = videoCanvas.getContext('2d')
    context?.drawImage(video, 0, 0, videoCanvas.width, videoCanvas.height)
    const url = videoCanvas.toDataURL('image/png')
    return url
  } else {
    return ''
  }
}

export default async function screenshot(): Promise<string> {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new Error(
        "element isn't defined because there's no window, are you running in Node?"
      )
    )
  }

  if (window.electron) {
    const canvas = document.querySelector('[data-engine]')
    if (canvas instanceof HTMLCanvasElement) {
      const url = await window.electron.takeElectronWindowScreenshot({
        width: canvas?.width || 500,
        height: canvas?.height || 500,
      })
      return url !== '' ? url : takeScreenshotOfVideoStreamCanvas()
    }
  }

  return takeScreenshotOfVideoStreamCanvas()
}

export async function createThumbnailPNGOnDesktop({
  id,
  projectDirectoryWithoutEndingSlash,
}: {
  id: string
  projectDirectoryWithoutEndingSlash: string
}) {
  if (!window.electron || !id || !projectDirectoryWithoutEndingSlash) {
    console.warn(
      'Cannot create thumbnail PNG: not desktop or missing parameters'
    )
    return
  }

  const electron = window.electron
  try {
    // zoom to fit command does not wait, wait 500ms to see if zoom to fit finishes
    await new Promise((resolve) => setTimeout(resolve, 500))
    const dataUrl: string = takeScreenshotOfVideoStreamCanvas()

    const thumbnailsDir = await getProjectThumbnailsPath(electron)
    const filePath = electron.path.join(thumbnailsDir, `${id}.png`)
    console.log('Writing thumbnail to', filePath)
    await writeProjectThumbnailFile(electron, dataUrl, filePath)

    // TODO: remove once we're retiring the old thumbnail.png
    const oldThumbnailPath = electron.path.join(
      projectDirectoryWithoutEndingSlash,
      PROJECT_IMAGE_NAME
    )
    console.log('Writing thumbnail to', oldThumbnailPath)
    await writeProjectThumbnailFile(electron, dataUrl, oldThumbnailPath)
  } catch (e) {
    console.error(`Failed to generate thumbnail`, e)
  }
}
