import { writeProjectThumbnailFile } from '@src/lib/desktop'

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

/**
 * Captures the video stream canvas composited with the gizmo overlay,
 * matching what the user sees in the modeling viewport.
 */
export function takeViewportScreenshot(): string {
  const canvas = document.querySelector('[data-engine]')
  const video = document.getElementById('video-stream')
  if (
    !canvas ||
    !video ||
    !(canvas instanceof HTMLCanvasElement) ||
    !(video instanceof HTMLVideoElement)
  ) {
    return ''
  }

  const compositeCanvas = document.createElement('canvas')
  compositeCanvas.width = canvas.width
  compositeCanvas.height = canvas.height
  const ctx = compositeCanvas.getContext('2d')
  if (!ctx) return ''

  // Draw the video stream (the 3D model)
  ctx.drawImage(video, 0, 0, compositeCanvas.width, compositeCanvas.height)

  // Draw the gizmo overlay if present
  const gizmoWrapper = document.querySelector(
    '[aria-label="View orientation gizmo"]'
  )
  const gizmoCanvas = gizmoWrapper?.querySelector('canvas')
  if (gizmoCanvas instanceof HTMLCanvasElement) {
    // The gizmo container is positioned absolute bottom-2 right-2 (8px)
    // relative to the modeling area. We need to map that to the canvas
    // coordinate space since the canvas may be a different size than the
    // on-screen element.
    const scaleX = compositeCanvas.width / canvas.clientWidth
    const scaleY = compositeCanvas.height / canvas.clientHeight
    const margin = 8
    const gizmoW = gizmoCanvas.clientWidth * scaleX
    const gizmoH = gizmoCanvas.clientHeight * scaleY
    const x = compositeCanvas.width - gizmoW - margin * scaleX
    const y = compositeCanvas.height - gizmoH - margin * scaleY
    ctx.drawImage(gizmoCanvas, x, y, gizmoW, gizmoH)
  }

  return compositeCanvas.toDataURL('image/png')
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

export function createThumbnailPNGOnDesktop({
  projectDirectoryWithoutEndingSlash,
}: {
  projectDirectoryWithoutEndingSlash: string
}) {
  setTimeout(() => {
    if (!projectDirectoryWithoutEndingSlash) {
      return
    }
    const dataUrl: string = takeScreenshotOfVideoStreamCanvas()
    // zoom to fit command does not wait, wait 500ms to see if zoom to fit finishes
    writeProjectThumbnailFile(dataUrl, projectDirectoryWithoutEndingSlash)
      .then(() => {})
      .catch((e) => {
        console.error(
          `Failed to generate thumbnail for ${projectDirectoryWithoutEndingSlash}`
        )
        console.error(e)
      })
  }, 500)
}
