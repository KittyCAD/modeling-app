/// The method below uses the File System Access API when it's supported and
// else falls back to the classic approach. In both cases the function saves
// the file, but in case of where the File System Access API is supported, the
import toast from 'react-hot-toast'

import { EXPORT_TOAST_MESSAGES } from './constants'

// user will get a file save dialog where they can choose where the file should be saved.
export const browserSaveFile = async (
  blob: Blob,
  suggestedName: string,
  toastId: string
) => {
  // Feature detection. The API needs to be supported
  // and the app not run in an iframe.
  const supportsFileSystemAccess =
    'showSaveFilePicker' in window &&
    (() => {
      try {
        return window.self === window.top
      } catch {
        return false
      }
    })()
  // If the File System Access API is supported…
  if (
    supportsFileSystemAccess &&
    window.showSaveFilePicker &&
    !(window as any).playwrightSkipFilePicker
  ) {
    try {
      // Show the file save dialog.
      const handle = await window.showSaveFilePicker({
        suggestedName,
      })
      // Write the blob to the file.
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      toast.success(EXPORT_TOAST_MESSAGES.SUCCESS, { id: toastId })
      return
    } catch (err: any) {
      // Fail silently if the user has simply canceled the dialog.
      if (err.name === 'AbortError') {
        toast.dismiss(toastId)
      } else {
        console.error(err.name, err.message)
        toast.error(EXPORT_TOAST_MESSAGES.FAILED, { id: toastId })
      }
      return
    }
  }
  // Fallback if the File System Access API is not supported…
  // Create the blob URL.
  const blobURL = URL.createObjectURL(blob)
  // Create the `<a download>` element and append it invisibly.
  const a = document.createElement('a')
  a.href = blobURL
  a.download = suggestedName
  a.style.display = 'none'
  document.body.append(a)
  // Programmatically click the element.
  a.click()
  // Revoke the blob URL and remove the element.
  setTimeout(() => {
    URL.revokeObjectURL(blobURL)
    a.remove()
  }, 1000)
  toast.success(EXPORT_TOAST_MESSAGES.SUCCESS, { id: toastId })
}
