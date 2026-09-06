export function showFreezeFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
) {
  if (!video.videoWidth || !video.videoHeight) return false

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
  video.style.display = 'none'
  return true
}

export function showLiveVideoOnNextFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
) {
  const showLiveVideo = () => {
    video.style.display = 'block'
    canvas.style.display = 'none'
  }

  if (typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(showLiveVideo)
    return
  }

  window.requestAnimationFrame(showLiveVideo)
}
