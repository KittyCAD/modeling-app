import { isTauri } from './isTauri'
import { deserialize_files } from '../wasm-lib/pkg/wasm_lib'
import { browserSaveFile } from './browserSaveFile'
import { save } from '@tauri-apps/api/dialog'
import { writeBinaryFile } from '@tauri-apps/api/fs'

// Saves files locally from an export call.
// The directory passed in is the directory to save the file to.
export async function exportSave(data: ArrayBuffer, dir = '') {
  // This converts the ArrayBuffer to a Rust equivalent Vec<u8>.
  let uintArray = new Uint8Array(data)
  try {
    const files: { contents: number[]; name: string }[] =
      deserialize_files(uintArray)
    for (const file of files) {
      if (isTauri()) {
        // Open a dialog to save the file.
        const filePath = await save({
          defaultPath: file.name,
        })

        if (filePath === null) {
          // The user canceled the save.
          // Return early.
          return
        }

        // Write the file.
        await writeBinaryFile(filePath, uintArray)
      } else {
        // Download the file to the user's computer.
        // Now we need to download the files to the user's downloads folder.
        // Or the destination they choose.
        // Iterate over the files.
        // Create a new blob.
        const blob = new Blob([new Uint8Array(file.contents)])
        // Save the file.
        browserSaveFile(blob, file.name)
      }
    }
  } catch (e) {
    // TODO: do something real with the error.
    console.log(e)
  }
}
