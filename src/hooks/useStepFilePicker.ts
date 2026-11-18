import { useRef } from 'react'
import toast from 'react-hot-toast'

import fsZds from '@src/lib/fs-zds'

export function useStepFilePicker(onFileSelected: (file: File) => void) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pickerOpen = useRef(false)

  const pickFile = async () => {
    const electron = window.electron
    if (!electron) {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
        fileInputRef.current.click()
      }
      return
    }

    if (pickerOpen.current) return
    pickerOpen.current = true
    try {
      const result = await electron.open({
        title: 'Import STEP as editable KCL',
        properties: ['openFile'],
        filters: [{ name: 'STEP models', extensions: ['step', 'stp'] }],
      })
      const filePath = result.filePaths?.[0]
      if (result.canceled || !filePath) return

      const bytes = await fsZds.readFile(filePath)
      onFileSelected(
        new File([new Uint8Array(bytes)], fsZds.basename(filePath))
      )
    } catch (error) {
      console.error('Could not open STEP file', error)
      toast.error('Could not open the STEP file. Please try again.')
    } finally {
      // Canceling, failing, and selecting all allow the next click to reopen.
      pickerOpen.current = false
    }
  }

  return { fileInputRef, pickFile }
}
