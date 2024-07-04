import html2canvas from 'html2canvas-pro'

// Return a data URL (png format) of the screenshot of the current page.
export default async function screenshot(): Promise<string> {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new Error(
        "element isn't defined because there's no window, are you running in Node?"
      )
    )
  }
  return html2canvas(document.documentElement)
    .then((canvas) => {
      return canvas.toDataURL()
    })
    .catch((error) => {
      return Promise.reject(error)
    })
}
