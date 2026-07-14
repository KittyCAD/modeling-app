import { writeProjectThumbnailFile } from '@src/lib/desktop'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { uuidv4 } from '@src/lib/utils'
import { getVisibleElementRect } from '@src/lib/viewportElement'
import type { ConnectionManager } from '@src/network/connectionManager'

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,'

type EngineSnapshotCommandManager = Pick<ConnectionManager, 'sendSceneCommand'>

const unwrapJsonString = (contents: string): string => {
  const trimmed = contents.trim()
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'string') {
      return parsed
    }
  } catch {}

  return trimmed.slice(1, -1)
}

const normalizeSnapshotPngContents = (contents: string): string => {
  const unwrappedContents = unwrapJsonString(contents)
  const pngContents = unwrappedContents.startsWith(PNG_DATA_URL_PREFIX)
    ? unwrappedContents.slice(PNG_DATA_URL_PREFIX.length)
    : unwrappedContents
  const base64 = pngContents
    .replace(/\s/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const paddingLength = (4 - (base64.length % 4)) % 4

  return `${base64}${'='.repeat(paddingLength)}`
}

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
  video: HTMLVideoElement,
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

  fullContext.drawImage(video, 0, 0, fullCanvas.width, fullCanvas.height)
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
  const crop = drawVisibleVideoStream(video, canvas, compositeCanvas)
  const ctx = compositeCanvas.getContext('2d')
  if (!crop) {
    return ''
  }
  if (!ctx) {
    return ''
  }

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
  const bytes = atob(base64)
  const buf = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    buf[i] = bytes.charCodeAt(i)
  }

  return new File([buf], fileName, { type: mime })
}

export async function takeEngineSnapshot({
  engineCommandManager,
}: {
  engineCommandManager: EngineSnapshotCommandManager
}): Promise<string> {
  const response = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'take_snapshot',
      format: 'png',
    },
  })
  const singleResponse = Array.isArray(response) ? response[0] : response

  if (!singleResponse || !isModelingResponse(singleResponse)) {
    return ''
  }

  const modelingResponse = singleResponse.resp.data.modeling_response
  if (modelingResponse.type !== 'take_snapshot') {
    return ''
  }

  const contents = modelingResponse.data?.contents
  if (typeof contents !== 'string' || !contents) {
    return ''
  }

  return `${PNG_DATA_URL_PREFIX}${normalizeSnapshotPngContents(contents)}`
}

export function createThumbnailPNGOnDesktop({
  projectDirectoryWithoutEndingSlash,
  engineCommandManager,
}: {
  projectDirectoryWithoutEndingSlash: string
  engineCommandManager: EngineSnapshotCommandManager
}) {
  setTimeout(() => {
    if (!projectDirectoryWithoutEndingSlash) {
      return
    }
    // Wait for any pending camera/view updates from the triggering workflow.
    takeEngineSnapshot({ engineCommandManager })
      .then((dataUrl) => {
        if (!dataUrl) {
          throw new Error('Invalid engine snapshot response')
        }
        return writeProjectThumbnailFile(
          dataUrl,
          projectDirectoryWithoutEndingSlash
        )
      })
      .then(() => {})
      .catch((e) => {
        console.error(
          `Failed to generate thumbnail for ${projectDirectoryWithoutEndingSlash}`
        )
        console.error(e)
      })
  }, 500)
}
