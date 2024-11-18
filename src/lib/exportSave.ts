import { isDesktop } from './isDesktop'
import { deserialize_files } from '../wasm-lib/pkg/wasm_lib'
import { browserSaveFile } from './browserSaveFile'

import JSZip from 'jszip'
import ModelingAppFile from './modelingAppFile'
import toast from 'react-hot-toast'
import { EXPORT_TOAST_MESSAGES } from './constants'
import { string } from 'yargs'

const save_ = async (file: ModelingAppFile, toastId: string) => {
  try {
    if (isDesktop()) {
      const extension = file.name.split('.').pop() || null
      let extensions: string[] = []
      if (extension !== null) {
        extensions.push(extension)
      }

      if (window.electron.process.env.IS_PLAYWRIGHT) {
        // skip file picker, save to default location
        await window.electron.writeFile(
          file.name,
          new Uint8Array(file.contents)
        )
        toast.success(EXPORT_TOAST_MESSAGES.SUCCESS, { id: toastId })
        return
      }

      // Open a dialog to save the file.
      const filePathMeta = await window.electron.save({
        defaultPath: file.name,
        filters: [
          {
            name: 'model',
            extensions: extensions,
          },
        ],
      })

      // The user canceled the save.
      // Return early.
      if (filePathMeta.canceled) {
        toast.dismiss(toastId)
        return
      }

      // Write the file.
      await window.electron.writeFile(
        filePathMeta.filePath,
        new Uint8Array(file.contents)
      )
      toast.success(EXPORT_TOAST_MESSAGES.SUCCESS, { id: toastId })
    } else {
      // Download the file to the user's computer.
      // Now we need to download the files to the user's downloads folder.
      // Or the destination they choose.
      // Iterate over the files.
      // Create a new blob.
      const blob = new Blob([new Uint8Array(file.contents)])
      // Save the file.
      await browserSaveFile(blob, file.name, toastId)
    }
  } catch (e) {
    // TODO: do something real with the error.
    console.error('export error', e)
    toast.error(EXPORT_TOAST_MESSAGES.FAILED, { id: toastId })
  }
}

// Saves files locally from an export call.
export async function exportSave(
  data: ArrayBuffer,
  filename: string,
  toastId: string
) {
  // This converts the ArrayBuffer to a Rust equivalent Vec<u8>.
  let uintArray = new Uint8Array(data)

  let files: ModelingAppFile[] = deserialize_files(uintArray)

  if (filename === '') {
    filename = 'output'
  }

  if (files.length > 1) {
    let zip = new JSZip()
    for (const file of files) {
      zip.file(file.name, new Uint8Array(file.contents), { binary: true })
    }
    return zip.generateAsync({ type: 'array' }).then((contents) => {
      return save_({ name: filename + '.zip', contents }, toastId)
    })
  } else {
    const file = files[0]
    return save_(
      { name: file.name.replace('output', filename), contents: file.contents },
      toastId
    )
  }
}
