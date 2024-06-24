import React from 'react'
import html2canvas from 'html2canvas-pro'

// Return a data URL (png format) of the screenshot of the current page.
export default async function screenshot(
  htmlRef: React.RefObject<HTMLDivElement> | null
): Promise<string> {
  if (htmlRef === null) {
    return Promise.reject(new Error('htmlRef is null'))
  }
  if (htmlRef.current === null) {
    return Promise.reject(new Error('htmlRef is null'))
  }
  return html2canvas(htmlRef.current)
    .then((canvas) => {
      return canvas.toDataURL()
    })
    .catch((error) => {
      return Promise.reject(error)
    })
}
