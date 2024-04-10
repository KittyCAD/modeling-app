import { toPng } from 'html-to-image'
import { useStore } from 'useStore'

// Return a data URL (png format) of the screenshot of the current page.
export default async function screenshot(): Promise<string> {
  const { htmlRef } = useStore((s) => ({
    htmlRef: s.htmlRef,
  }))
  if (htmlRef === null) {
    throw new Error('htmlRef is null')
  }
  if (htmlRef.current === null) {
    throw new Error('htmlRef is null')
  }
  return toPng(htmlRef.current)
}
