import type { LocalRenderer } from '@src/clientSideScene/localRenderer/LocalRenderer'
import { base64ToBytes } from '@src/lib/base64'
import { writeProjectThumbnailFile } from '@src/lib/desktop'
import { getVisibleElementRect } from '@src/lib/viewportElement'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

const getVisibleCanvasCrop = (canvas: HTMLCanvasElement) => {
  const canvasRect = canvas.getBoundingClientRect()
  const visibleRect = getVisibleElementRect(canvas)

  if (!visibleRect || canvasRect.width <= 0 || canvasRect.height <= 0) {
    return null
  }

  const scaleX = canvas.width / canvasRect.width
  const scaleY = canvas.height / canvasRect.height
  const sourceX = Math.max(
    0,
    Math.round((visibleRect.left - canvasRect.left) * scaleX)
  )
  const sourceY = Math.max(
    0,
    Math.round((visibleRect.top - canvasRect.top) * scaleY)
  )
  const sourceWidth = Math.min(
    canvas.width - sourceX,
    Math.max(1, Math.round(visibleRect.width * scaleX))
  )
  const sourceHeight = Math.min(
    canvas.height - sourceY,
    Math.max(1, Math.round(visibleRect.height * scaleY))
  )

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null
  }

  return {
    visibleRect,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
  }
}

const drawVisibleVideoStream = (
  frameSource: HTMLVideoElement | HTMLCanvasElement,
  canvas: HTMLCanvasElement,
  targetCanvas: HTMLCanvasElement
) => {
  const crop = getVisibleCanvasCrop(canvas)
  if (!crop) {
    return null
  }

  const fullCanvas = document.createElement('canvas')
  fullCanvas.width = canvas.width
  fullCanvas.height = canvas.height
  const fullContext = fullCanvas.getContext('2d')
  if (!fullContext) {
    return null
  }

  fullContext.drawImage(frameSource, 0, 0, fullCanvas.width, fullCanvas.height)
  targetCanvas.width = crop.sourceWidth
  targetCanvas.height = crop.sourceHeight
  const targetContext = targetCanvas.getContext('2d')
  if (!targetContext) {
    return null
  }
  targetContext.drawImage(
    fullCanvas,
    crop.sourceX,
    crop.sourceY,
    crop.sourceWidth,
    crop.sourceHeight,
    0,
    0,
    targetCanvas.width,
    targetCanvas.height
  )

  return crop
}

/** Copies the frame before returning, and encodes it afterwards. */
function encodeVisibleFrame(
  frameSource: HTMLVideoElement | HTMLCanvasElement,
  canvas: HTMLCanvasElement
): Promise<Blob | null> {
  const frameCanvas = document.createElement('canvas')
  const crop = drawVisibleVideoStream(frameSource, canvas, frameCanvas)
  if (!crop) {
    return Promise.resolve(null)
  }
  return new Promise((resolve, reject) => {
    // Serialize thumbnails asynchronously so PNG encoding does not block input.
    frameCanvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('Failed to encode project thumbnail'))
      }
    }, 'image/png')
  })
}

async function takeScreenshotOfVideoStreamCanvas(): Promise<Blob | null> {
  const canvas = document.querySelector('[data-engine]')
  const video = document.getElementById('video-stream')
  if (
    canvas &&
    video &&
    canvas instanceof HTMLCanvasElement &&
    video instanceof HTMLVideoElement
  ) {
    return encodeVisibleFrame(video, canvas)
  } else {
    return null
  }
}

/**
 * Draws the visible part of the 3D scene: from the local renderer if there is
 * one, else from the video.
 */
const drawVisibleScene = (
  targetCanvas: HTMLCanvasElement,
  localRenderer?: LocalRenderer | null
) => {
  if (localRenderer) {
    return localRenderer.readFrame((renderedCanvas) =>
      drawVisibleVideoStream(renderedCanvas, renderedCanvas, targetCanvas)
    )
  }
  const canvas = document.querySelector('[data-engine]')
  const video = document.getElementById('video-stream')
  if (
    canvas instanceof HTMLCanvasElement &&
    video instanceof HTMLVideoElement
  ) {
    return drawVisibleVideoStream(video, canvas, targetCanvas)
  }
  return null
}

/**
 * Captures the 3D scene composited with the gizmo overlay, matching what the
 * user sees in the modeling viewport.
 */
export function takeViewportScreenshot(
  localRenderer?: LocalRenderer | null
): string {
  const compositeCanvas = document.createElement('canvas')
  const crop = drawVisibleScene(compositeCanvas, localRenderer)
  const ctx = compositeCanvas.getContext('2d')
  if (!crop) return ''
  if (!ctx) return ''

  // Draw the gizmo overlay if present
  const gizmoWrapper = document.querySelector(
    '[aria-label="View orientation gizmo"]'
  )
  const gizmoCanvas = gizmoWrapper?.querySelector('canvas')
  if (gizmoCanvas instanceof HTMLCanvasElement) {
    const gizmoRect = gizmoCanvas.getBoundingClientRect()
    const scaleX = compositeCanvas.width / crop.visibleRect.width
    const scaleY = compositeCanvas.height / crop.visibleRect.height
    const gizmoW = gizmoRect.width * scaleX
    const gizmoH = gizmoRect.height * scaleY
    const x = (gizmoRect.left - crop.visibleRect.left) * scaleX
    const y = (gizmoRect.top - crop.visibleRect.top) * scaleY
    ctx.drawImage(gizmoCanvas, x, y, gizmoW, gizmoH)
  }

  return compositeCanvas.toDataURL('image/png')
}

export function dataUrlToFile(dataUrl: string, fileName: string): File | Error {
  const [header, base64] = dataUrl.split(',')
  if (!header || !base64) {
    return new Error('Invalid data URL')
  }

  const mime = header.match(/:(.*?);/)?.[1] ?? 'application/octet-stream'
  const buf = base64ToBytes(base64)

  return new File([buf], fileName, { type: mime })
}

interface ThumbnailTaskState {
  cancel: (() => void) | undefined
  writes: Promise<void>
}

const thumbnailTasks = new WeakMap<
  FileOperationsRegistryService,
  ThumbnailTaskState
>()

export function createProjectThumbnail({
  fileOperations,
  projectDirectoryWithoutEndingSlash,
  renderedCanvas,
  isCurrent,
  writeThumbnail = (path, bytes) =>
    writeProjectThumbnailFile(fileOperations, bytes, path),
}: {
  fileOperations: FileOperationsRegistryService
  projectDirectoryWithoutEndingSlash: string
  /** Copy a locally rendered canvas in the same task, before its GPU buffer clears. */
  renderedCanvas?: HTMLCanvasElement
  isCurrent: () => boolean
  writeThumbnail?: (path: string, bytes: Uint8Array) => Promise<void>
}) {
  const state: ThumbnailTaskState = thumbnailTasks.get(fileOperations) ?? {
    cancel: undefined,
    writes: Promise.resolve(),
  }
  thumbnailTasks.set(fileOperations, state)
  state.cancel?.()
  if (!projectDirectoryWithoutEndingSlash || !isCurrent()) return

  let cancelled = false
  let cleanupStream: (() => void) | undefined
  const cancel = () => {
    cancelled = true
    cleanupStream?.()
    window.removeEventListener('pagehide', cancel)
    if (state.cancel === cancel) state.cancel = undefined
  }
  const save = (
    screenshot: Promise<Blob | null>,
    ownsCapture: () => boolean
  ) => {
    screenshot
      .then(async (thumbnail) => {
        if (!thumbnail || !ownsCapture()) return
        const bytes = new Uint8Array(await thumbnail.arrayBuffer())
        // File writes cannot be cancelled once started. Serialize them so an
        // older write cannot finish after a newer project's current capture.
        state.writes = state.writes
          .catch(() => {})
          .then(async () => {
            if (!ownsCapture()) return
            await writeThumbnail(projectDirectoryWithoutEndingSlash, bytes)
          })
        await state.writes
      })
      .catch((error) => {
        console.error(
          `Failed to generate thumbnail for ${projectDirectoryWithoutEndingSlash}`
        )
        console.error(error)
      })
      .finally(cancel)
  }
  state.cancel = cancel
  window.addEventListener('pagehide', cancel, { once: true })

  if (renderedCanvas) {
    const ownsCapture = () =>
      !cancelled && isCurrent() && renderedCanvas.isConnected
    if (ownsCapture()) {
      save(encodeVisibleFrame(renderedCanvas, renderedCanvas), ownsCapture)
    } else {
      cancel()
    }
    return cancel
  }

  const video = document.getElementById('video-stream')
  const canvas = document.querySelector('[data-engine]')
  if (
    !(video instanceof HTMLVideoElement) ||
    !(canvas instanceof HTMLCanvasElement) ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    video.paused ||
    video.ended
  ) {
    cancel()
    return
  }
  const source = video.srcObject
  const currentSrc = video.currentSrc
  let frame: number | undefined
  cleanupStream = () => {
    if (frame !== undefined) video.cancelVideoFrameCallback(frame)
    for (const event of ['pause', 'ended', 'emptied'])
      video.removeEventListener(event, cancel)
  }
  const ownsCapture = () =>
    !cancelled &&
    isCurrent() &&
    video.isConnected &&
    canvas.isConnected &&
    document.getElementById('video-stream') === video &&
    document.querySelector('[data-engine]') === canvas &&
    video.srcObject === source &&
    video.currentSrc === currentSrc &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    !video.paused &&
    !video.ended

  for (const event of ['pause', 'ended', 'emptied'])
    video.addEventListener(event, cancel, { once: true })
  // Require a newly presented frame after execution, not a guessed camera
  // duration or an already decoded old model. This is not a command/frame ACK.
  frame = video.requestVideoFrameCallback(() => {
    frame = undefined
    if (!ownsCapture()) {
      cancel()
      return
    }
    save(takeScreenshotOfVideoStreamCanvas(), ownsCapture)
  })
  return cancel
}
