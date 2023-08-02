import { isTauri } from './isTauri'
import { invoke } from '@tauri-apps/api/tauri'
import { deserialize_files } from '../wasm-lib/pkg/wasm_lib'
import { browserSaveFile } from './browserSaveFile'

// Saves files locally from an export call.
// The directory passed in is the directory to save the file to.
export function exportSave(data: ArrayBuffer, dir: string) {
  // This converts the ArrayBuffer to a Rust equivalent Vec<u8>.
  let uintArray = new Uint8Array(data)
  if (isTauri()) {
    // Call the tauri function to save the file.
    // For tauri we need to do an Array.from.
    let d = Array.from(uintArray)
    invoke('export_save', { dir: dir, data: d })
  } else {
    // Download the file to the user's computer.
    try {
      const files = deserialize_files(uintArray)
      // Now we need to download the files to the user's downloads folder.
      // Or the destination they choose.
      // Iterate over the files.
      files.forEach((file: { contents: number[]; name: string }) => {
        // Create a new blob.
        const blob = new Blob([new Uint8Array(file.contents)])
        // Save the file.
        browserSaveFile(blob, file.name)
      })
    } catch (e) {
      // TODO: do something real with the error.
      console.log(e)
    }
  }
}
