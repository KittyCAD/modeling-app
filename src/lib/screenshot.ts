import { toPng } from 'html-to-image'
import React from 'react'
import { useStore } from 'useStore'

// Return a data URL (png format) of the screenshot of the current page.
export default async function screenshot(
  htmlRef: React.RefObject<HTMLDivElement> | null
): Promise<string> {
  if (htmlRef === null) {
    throw new Error('htmlRef is null')
  }
  if (htmlRef.current === null) {
    throw new Error('htmlRef is null')
  }
  return toPng(htmlRef.current)
}
