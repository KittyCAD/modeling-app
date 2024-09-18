export default async function screenshot(): Promise<string> {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new Error(
        "element isn't defined because there's no window, are you running in Node?"
      )
    )
  }

  return new Promise((resolve, reject) => {
    const canvas = document.querySelector('[data-engine]')
    const video = document.getElementById('video-stream')

    // overlay the sketch canvas as well?
    // Update the github issue to indicate that we cannot take screenshots?
    // Implement screenshots in electron?

    if (canvas && video) {
      const videoCanvas = document.createElement('canvas')
      videoCanvas.width = canvas.width
      videoCanvas.height = canvas.height
      const context = videoCanvas.getContext('2d')
      context.drawImage(video, 0, 0, videoCanvas.width, videoCanvas.height)
      const url = videoCanvas.toDataURL('image/png')
      resolve(url)
    } else {
      reject(
        'no canvas or multiple canvas were found with attribute data-engine'
      )
    }
  })
}
