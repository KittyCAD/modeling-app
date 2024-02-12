import {
  readBinaryFile,
  exists as tauriExists,
  BaseDirectory,
} from '@tauri-apps/api/fs'
import { isTauri } from 'lib/isTauri'

export function readFile(path: string): Promise<Uint8Array> {
  // Using local file system only works from Tauri.
  if (!isTauri()) {
    throw new Error('This function can only be called from a Tauri application')
  }

  console.log('readFile path', path, BaseDirectory.AppConfig)
  return readBinaryFile(path, { dir: BaseDirectory.AppConfig })
}

export function exists(path: string): Promise<boolean> {
  // Using local file system only works from Tauri.
  if (!isTauri()) {
    throw new Error('This function can only be called from a Tauri application')
  }
  console.log('exists path', path, BaseDirectory.AppConfig)

  return tauriExists(path, { dir: BaseDirectory.AppConfig })
}
