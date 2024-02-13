import {
  readFile,
  exists as tauriExists,
} from '@tauri-apps/plugin-fs'
import { isTauri } from 'lib/isTauri'
import { join } from '@tauri-apps/api/path'

/// FileSystemManager is a class that provides a way to read files from the local file system.
/// It assumes that you are in a project since it is solely used by the std lib
/// when executing code.
class FileSystemManager {
  private _dir: string | null = null

  get dir() {
    if (this._dir === null) {
      throw new Error('current project dir is not set')
    }

    return this._dir
  }

  set dir(dir: string) {
    this._dir = dir
  }

  readFile(path: string): Promise<Uint8Array | void> {
    // Using local file system only works from Tauri.
    if (!isTauri()) {
      throw new Error(
        'This function can only be called from a Tauri application'
      )
    }

    return join(this.dir, path)
      .catch((error) => {
        throw new Error(`Error reading file: ${error}`)
      })
      .then((file) => {
        return readFile(file)
      })
  }

  exists(path: string): Promise<boolean | void> {
    // Using local file system only works from Tauri.
    if (!isTauri()) {
      throw new Error(
        'This function can only be called from a Tauri application'
      )
    }

    return join(this.dir, path)
      .catch((error) => {
        throw new Error(`Error checking file exists: ${error}`)
      })
      .then((file) => {
        return tauriExists(file)
      })
  }
}

export const fileSystemManager = new FileSystemManager()
