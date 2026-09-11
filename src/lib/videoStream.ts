const pendingReveals = new WeakMap<HTMLVideoElement, () => void>()

export function showFreezeFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
) {
  pendingReveals.get(video)?.()

  // A second idle can interrupt reconnect before it has a new frame. Keep
  // the last good picture instead of drawing an empty/stopped stream over it.
  if (canvas.style.display === 'block') return true
  if (
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    !video.videoWidth ||
    !video.videoHeight
  )
    return false

  const context = canvas.getContext('2d')
  if (!context) return false

  canvas.width = video.videoWidth
  canvas.height = video.videoHeight

  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
  } catch (error) {
    console.warn('Unable to capture the engine stream freeze frame', error)
    return false
  }

  canvas.style.display = 'block'
  // The canvas overlays the video. Keep the video renderable so a replacement
  // autoplay stream can emit `playing` and present its first frame.
  return true
}

export function showLiveVideoOnNextFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  onLive?: () => void
) {
  pendingReveals.get(video)?.()
  const stream = video.srcObject
  let cancelled = false
  let cancelFrame = () => {}
  const cancel = () => {
    cancelled = true
    cancelFrame()
    pendingReveals.delete(video)
  }
  const showLiveVideo = () => {
    if (cancelled) return
    if (video.srcObject !== stream) {
      cancel()
      return
    }
    pendingReveals.delete(video)
    canvas.style.display = 'none'
    onLive?.()
  }
  pendingReveals.set(video, cancel)

  if (typeof video.requestVideoFrameCallback === 'function') {
    const frame = video.requestVideoFrameCallback(showLiveVideo)
    cancelFrame = () => video.cancelVideoFrameCallback(frame)
    return
  }

  const frame = window.requestAnimationFrame(showLiveVideo)
  cancelFrame = () => window.cancelAnimationFrame(frame)
}
