const pendingReveals = new WeakMap<HTMLVideoElement, () => void>()

export function showFreezeFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
) {
  pendingReveals.get(video)?.()

  // A second disconnect can interrupt recovery before it has a new frame.
  // Keep the last good picture instead of capturing the unfinished stream.
  if (canvas.style.display === 'block') return
  if (
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    !video.videoWidth ||
    !video.videoHeight
  )
    return

  const context = canvas.getContext('2d')
  if (!context) return

  canvas.width = video.videoWidth
  canvas.height = video.videoHeight

  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
  } catch (error) {
    console.warn('Unable to capture the engine stream freeze frame', error)
    return
  }

  canvas.style.display = 'block'
}

export function showLiveVideoOnNextFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  {
    signal,
    timeoutMs = 10_000,
  }: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<boolean> {
  pendingReveals.get(video)?.()
  if (signal?.aborted) return Promise.resolve(false)

  return new Promise((resolve) => {
    const stream = video.srcObject
    let cancelled = false
    let cancelFrame = () => {}
    let timeout = 0

    function clearPresentationTimeout() {
      window.clearTimeout(timeout)
      timeout = 0
    }

    function forgetPendingReveal() {
      if (pendingReveals.get(video) === cancel) {
        pendingReveals.delete(video)
      }
    }

    function cleanUp() {
      clearPresentationTimeout()
      document.removeEventListener('visibilitychange', updateTimeout)
      signal?.removeEventListener('abort', cancel)
      forgetPendingReveal()
    }

    function cancel() {
      if (cancelled) return
      cancelled = true
      cancelFrame()
      cleanUp()
      resolve(false)
    }

    function showLiveVideo() {
      if (cancelled) return
      if (video.srcObject !== stream) {
        cancel()
        return
      }
      cancelled = true
      cleanUp()
      canvas.style.display = 'none'
      resolve(true)
    }

    function updateTimeout() {
      clearPresentationTimeout()
      if (document.visibilityState === 'visible') {
        timeout = window.setTimeout(cancel, timeoutMs)
      }
    }

    pendingReveals.set(video, cancel)
    document.addEventListener('visibilitychange', updateTimeout)
    signal?.addEventListener('abort', cancel, { once: true })
    updateTimeout()

    if (typeof video.requestVideoFrameCallback === 'function') {
      const frame = video.requestVideoFrameCallback(showLiveVideo)
      cancelFrame = () => video.cancelVideoFrameCallback(frame)
      return
    }

    const frame = window.requestAnimationFrame(showLiveVideo)
    cancelFrame = () => window.cancelAnimationFrame(frame)
  })
}
