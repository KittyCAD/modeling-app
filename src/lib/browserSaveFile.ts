// Saves a file through the File System Access API when possible, then falls
// back to a normal browser download link.

import toast from 'react-hot-toast'

import { EXPORT_TOAST_MESSAGES } from '@src/lib/constants'

/** The observable outcome of a browser or desktop-style file save flow. */
export type FileSaveResult =
  | { status: 'saved' }
  | { status: 'cancelled' }
  | { status: 'failed'; error: Error }

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
): FileSaveResult => {
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
  return { status: 'saved' }
}

// user will get a file save dialog where they can choose where the file should be saved.
export const browserSaveFileWithResult = async (
  blob: Blob,
  suggestedName: string,
  toastId: string
): Promise<FileSaveResult> => {
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
      return { status: 'saved' }
    } catch (err: unknown) {
      const name = errorName(err)

      // Fail silently if the user has simply canceled the dialog.
      if (name === 'AbortError') {
        toast.dismiss(toastId)
        return { status: 'cancelled' }
      } else if (name === 'NotAllowedError') {
        return saveWithDownloadLink(blob, suggestedName, toastId)
      } else {
        console.error(name, err)
        toast.error(EXPORT_TOAST_MESSAGES.FAILED, { id: toastId })
        return {
          status: 'failed',
          error: err instanceof Error ? err : new Error(String(err)),
        }
      }
    }
  }
  // Fallback if the File System Access API is not supported…
  return saveWithDownloadLink(blob, suggestedName, toastId)
}

/** Save a browser file while preserving the legacy fire-and-forget contract. */
export const browserSaveFile = async (
  blob: Blob,
  suggestedName: string,
  toastId: string
): Promise<void> => {
  await browserSaveFileWithResult(blob, suggestedName, toastId)
}
