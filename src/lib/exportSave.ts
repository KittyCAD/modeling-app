import { isTauri } from './isTauri'
import { invoke } from '@tauri-apps/api/tauri'

// Saves files locally from an export call.
// The directory passed in is the directory to save the file to.
export function exportSave(data: ArrayBuffer, dir: string) {
  if (isTauri()) {
    // Call the tauri function to save the file.
    let d = new Uint8Array(data)
      console.log(d)
    invoke('export_save', { dir: dir, data: d })
  } else {
    // Download the file to the user's computer.
  }
}
