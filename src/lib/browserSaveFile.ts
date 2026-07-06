// Saves a file through the File System Access API when possible, then falls
// back to a normal browser download link.
import toast from 'react-hot-toast'

import { EXPORT_TOAST_MESSAGES } from '@src/lib/constants'

const getSuggestedExtension = (suggestedName: string): `.${string}` | null => {
  const finalDotIndex = suggestedName.lastIndexOf('.')
  if (finalDotIndex <= 0 || finalDotIndex === suggestedName.length - 1) {
    return null
  }

  const ext = suggestedName.slice(finalDotIndex + 1).toLowerCase()
  if (!ext) return null

  return `.${ext}`
}

export const getShowSaveFilePickerOptions = (
  suggestedName: string
): SaveFilePickerOptions => {
  const options: SaveFilePickerOptions = {
    suggestedName,
  }

  const extension = getSuggestedExtension(suggestedName)
  if (!extension) {
    return options
  }

  options.types = [
    {
      description: `${extension.slice(1).toUpperCase()} files`,
      accept: {
        'application/octet-stream': [extension],
      },
    },
  ]
  options.excludeAcceptAllOption = true

  return options
}

const errorName = (err: unknown) => {
  if (typeof err === 'object' && err && 'name' in err) {
    return String(err.name)
  }

  return ''
}

const saveWithDownloadLink = (
  blob: Blob,
  suggestedName: string,
  toastId: string
) => {
  const blobURL = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = blobURL
  a.download = suggestedName
  a.style.display = 'none'
  document.body.append(a)
  a.click()

  setTimeout(() => {
    URL.revokeObjectURL(blobURL)
    a.remove()
  }, 1000)
  toast.success(EXPORT_TOAST_MESSAGES.SUCCESS, { id: toastId })
}

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
      const handle = await window.showSaveFilePicker(
        getShowSaveFilePickerOptions(suggestedName)
      )
      // Write the blob to the file.
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      toast.success(EXPORT_TOAST_MESSAGES.SUCCESS, { id: toastId })
      return
    } catch (err: unknown) {
      const name = errorName(err)

      // Fail silently if the user has simply canceled the dialog.
      if (name === 'AbortError') {
        toast.dismiss(toastId)
      } else if (name === 'NotAllowedError') {
        saveWithDownloadLink(blob, suggestedName, toastId)
      } else {
        console.error(name, err)
        toast.error(EXPORT_TOAST_MESSAGES.FAILED, { id: toastId })
      }
      return
    }
  }
  // Fallback if the File System Access API is not supported…
  saveWithDownloadLink(blob, suggestedName, toastId)
}
