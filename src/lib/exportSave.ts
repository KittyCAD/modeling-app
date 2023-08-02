import { isTauri } from './isTauri'
import { invoke } from '@tauri-apps/api/tauri'

// Saves files locally from an export call.
// The directory passed in is the directory to save the file to.
export function exportSave(data: ArrayBuffer, dir: string) {
  if (isTauri()) {
    // Call the tauri function to save the file.
    // This converts the ArrayBuffer to a Rust equivalent Vec<u8>.
    let d = Array.from(new Uint8Array(data))
    invoke('export_save', { dir: dir, data: d })
  } else {
    // Download the file to the user's computer.
  }
}
