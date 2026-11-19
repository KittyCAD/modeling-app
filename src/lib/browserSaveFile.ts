import toast from 'react-hot-toast'

// Downloads a generated file using the browser's download preferences.
export const browserSaveFile = async (
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
  toast.success('Download started', { id: toastId })
}
