import {
  readBinaryFile,
  exists as tauriExists,
  BaseDirectory,
} from '@tauri-apps/api/fs'
import { isTauri } from 'lib/isTauri'

function readFile(path: string): Promise<Uint8Array> {
  // Using local file system only works from Tauri.
  if (!isTauri()) {
    throw new Error('This function can only be called from a Tauri application')
  }

  return readBinaryFile(path, { dir: BaseDirectory.AppConfig })
}

function exists(path: string): Promise<boolean> {
  // Using local file system only works from Tauri.
  if (!isTauri()) {
    throw new Error('This function can only be called from a Tauri application')
  }

  return tauriExists(path, { dir: BaseDirectory.AppConfig })
}
