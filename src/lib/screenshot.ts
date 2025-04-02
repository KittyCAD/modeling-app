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
