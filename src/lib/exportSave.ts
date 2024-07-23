import { isDesktop } from './isDesktop'
import { deserialize_files } from '../wasm-lib/pkg/wasm_lib'
import { browserSaveFile } from './browserSaveFile'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'

import JSZip from 'jszip'

interface ModelingAppFile {
  name: string
  contents: number[]
}

const save_ = async (file: ModelingAppFile) => {
  try {
    if (isDesktop()) {
      const extension = file.name.split('.').pop() || null
      let extensions: string[] = []
      if (extension !== null) {
        extensions.push(extension)
      }

      // Open a dialog to save the file.
      const filePath = await save({
        defaultPath: file.name,
        filters: [
          {
            name: 'model',
            extensions: extensions,
          },
        ],
      })

      if (filePath === null) {
        // The user canceled the save.
        // Return early.
        return
      }

      // Write the file.
      await writeFile(filePath, new Uint8Array(file.contents))
    } else {
      // Download the file to the user's computer.
      // Now we need to download the files to the user's downloads folder.
      // Or the destination they choose.
      // Iterate over the files.
      // Create a new blob.
      const blob = new Blob([new Uint8Array(file.contents)])
      // Save the file.
      await browserSaveFile(blob, file.name)
    }
  } catch (e) {
    // TODO: do something real with the error.
    console.log('export error', e)
  }
}

// Saves files locally from an export call.
export async function exportSave(data: ArrayBuffer) {
  // This converts the ArrayBuffer to a Rust equivalent Vec<u8>.
  let uintArray = new Uint8Array(data)

  let files: ModelingAppFile[] = deserialize_files(uintArray)

  if (files.length > 1) {
    let zip = new JSZip()
    for (const file of files) {
      zip.file(file.name, new Uint8Array(file.contents), { binary: true })
    }
    return zip.generateAsync({ type: 'array' }).then((contents) => {
      return save_({ name: 'output.zip', contents })
    })
  } else {
    return save_(files[0])
  }
}
