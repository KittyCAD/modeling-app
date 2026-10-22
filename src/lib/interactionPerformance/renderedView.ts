import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { isVisible } from '@src/lib/interactionPerformance/outcomes'
import type { InteractionOutcome } from '@src/lib/interactionPerformance/types'
import { getVisibleElementRect } from '@src/lib/viewportElement'

interface RenderedViewOptions {
  document: Document
  getScene: () => SceneInfra | undefined
  /** The complete action outcome, including owned model/camera/UI state. */
  isReady: () => boolean
  kind: 'client' | 'stream'
  requireViewChange?: boolean
}

function currentVideo(document: Document) {
  const video = document.getElementById('video-stream')
  return video instanceof HTMLVideoElement &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0 &&
    isVisible(video)
    ? video
    : undefined
}

/** Read the visible video, not an overlaid gizmo or an offscreen decoded buffer. */
function readVideoPixels(document: Document, video: HTMLVideoElement) {
  const visible = getVisibleElementRect(video)
  const bounds = video.getBoundingClientRect()
  if (!visible || bounds.width <= 0 || bounds.height <= 0) return undefined
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(visible.width))
  canvas.height = Math.max(1, Math.round(visible.height))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return undefined
  try {
    const scaleX = video.videoWidth / bounds.width
    const scaleY = video.videoHeight / bounds.height
    context.drawImage(
      video,
      (visible.left - bounds.left) * scaleX,
      (visible.top - bounds.top) * scaleY,
      visible.width * scaleX,
      visible.height * scaleY,
      0,
      0,
      canvas.width,
      canvas.height
    )
    return context.getImageData(0, 0, canvas.width, canvas.height)
  } catch {
    // An unreadable frame is missing evidence, never an immediate success.
    return undefined
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

function viewChanged(before: ImageData, after: ImageData) {
  if (before.width !== after.width || before.height !== after.height)
    return false
  let changedPixels = 0
  for (let index = 0; index < before.data.length; index += 4) {
    // Ignore small codec fluctuations. The existing scene image-diff fixture
    // likewise requires more than 200 changed pixels, rather than one pixel.
    if (
      Math.max(
        Math.abs(before.data[index] - after.data[index]),
        Math.abs(before.data[index + 1] - after.data[index + 1]),
        Math.abs(before.data[index + 2] - after.data[index + 2])
      ) > 24 &&
      ++changedPixels > 200
    )
      return true
  }
  return false
}

/**
 * Require a real rendering of an already semantically ready action. The recorder
 * still owns its normal post-render observation cycle and must dispose this
 * outcome on completion, timeout, replacement, or stop.
 *
 * A video callback proves submission to the compositor, not which engine command
 * produced that frame. There is no command/frame correlation in the current
 * stream. Changed pixels settling across consecutive presented frames strengthen
 * camera evidence, but are not a reference-image proof of final engine geometry.
 * A client render counter likewise records Three rendering, not physical display
 * scanout.
 */
export function createRenderedViewOutcome({
  document,
  getScene,
  isReady: actionReady,
  kind,
  requireViewChange = false,
}: RenderedViewOptions): InteractionOutcome {
  const initialVideo = requireViewChange ? currentVideo(document) : undefined
  let initialPixels = initialVideo
    ? readVideoPixels(document, initialVideo)
    : undefined
  let disposed = false
  let sceneAtReady: SceneInfra | undefined
  let clientFrameAtReady: number | undefined
  let videoAtReady: HTMLVideoElement | undefined
  let readyAt: number | undefined
  let expectedDisplayAt: number | undefined
  let videoCallback: number | undefined
  let candidatePixels: ImageData | undefined
  let candidatePresentedFrame: number | undefined

  function reset() {
    if (videoAtReady && videoCallback !== undefined)
      videoAtReady.cancelVideoFrameCallback(videoCallback)
    videoCallback = undefined
    videoAtReady = undefined
    sceneAtReady = undefined
    clientFrameAtReady = undefined
    readyAt = undefined
    expectedDisplayAt = undefined
    candidatePixels = undefined
    candidatePresentedFrame = undefined
  }

  return {
    isReady() {
      if (disposed) return false
      if (!actionReady()) {
        reset()
        return false
      }
      if (kind === 'client') {
        const scene = getScene()
        if (!scene || !isVisible(scene.renderer.domElement)) {
          reset()
          return false
        }
        const currentFrame = scene.renderer.info.render.frame
        if (
          scene !== sceneAtReady ||
          clientFrameAtReady === undefined ||
          currentFrame < clientFrameAtReady
        ) {
          sceneAtReady = scene
          clientFrameAtReady = currentFrame
          return false
        }
        return currentFrame > clientFrameAtReady
      }

      const video = currentVideo(document)
      const clock = document.defaultView?.performance
      if (!video || !clock) {
        reset()
        return false
      }
      if (video !== videoAtReady) {
        reset()
        videoAtReady = video
        readyAt = clock.now()
      }
      if (expectedDisplayAt !== undefined)
        return clock.now() >= expectedDisplayAt
      if (videoCallback === undefined) {
        videoCallback = video.requestVideoFrameCallback((_now, metadata) => {
          videoCallback = undefined
          if (disposed || video !== videoAtReady) return
          if (!actionReady() || currentVideo(document) !== video) {
            reset()
            return
          }
          // A late callback may describe a frame submitted before semantic idle.
          // Do not count it merely because the callback itself ran afterwards.
          if (
            readyAt === undefined ||
            metadata.presentationTime < readyAt ||
            metadata.presentedFrames <= 0
          )
            return
          if (requireViewChange) {
            const pixels = readVideoPixels(document, video)
            if (
              !initialPixels ||
              !pixels ||
              !viewChanged(initialPixels, pixels)
            ) {
              candidatePixels = undefined
              candidatePresentedFrame = undefined
              return
            }
            const previousPixels = candidatePixels
            const previousFrame = candidatePresentedFrame
            candidatePixels = pixels
            candidatePresentedFrame = metadata.presentedFrames
            // The first changed frame may be an intermediate engine camera
            // tween. Require consecutive native frames with settled pixels; a
            // skipped frame is not evidence that the view remained unchanged.
            if (
              !previousPixels ||
              previousFrame === undefined ||
              metadata.presentedFrames !== previousFrame + 1 ||
              previousPixels.width !== pixels.width ||
              previousPixels.height !== pixels.height ||
              viewChanged(previousPixels, pixels)
            )
              return
            candidatePixels = undefined
            candidatePresentedFrame = undefined
          }
          expectedDisplayAt = metadata.expectedDisplayTime
        })
      }
      return false
    },
    dispose() {
      disposed = true
      reset()
      initialPixels = undefined
    },
  }
}
