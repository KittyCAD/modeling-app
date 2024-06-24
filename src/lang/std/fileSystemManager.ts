import { readFile, exists as tauriExists } from '@tauri-apps/plugin-fs'
import { isTauri } from 'lib/isTauri'
import { join } from '@tauri-apps/api/path'
import { readDirRecursive } from 'lib/tauri'

/// FileSystemManager is a class that provides a way to read files from the local file system.
/// It assumes that you are in a project since it is solely used by the std lib
/// when executing code.
class FileSystemManager {
  private _dir: string | null = null

  get dir() {
    return this._dir ?? ''
  }

  set dir(dir: string) {
    this._dir = dir
  }

  async readFile(path: string): Promise<Uint8Array | void> {
    // Using local file system only works from Tauri.
    if (!isTauri()) {
      return Promise.reject(
        new Error('This function can only be called from a Tauri application')
      )
    }

    return join(this.dir, path)
      .catch((error) => {
        return Promise.reject(new Error(`Error reading file: ${error}`))
      })
      .then((file) => {
        return readFile(file)
      })
  }

  async exists(path: string): Promise<boolean | void> {
    // Using local file system only works from Tauri.
    if (!isTauri()) {
      return Promise.reject(
        new Error('This function can only be called from a Tauri application')
      )
    }

    return join(this.dir, path)
      .catch((error) => {
        return Promise.reject(new Error(`Error checking file exists: ${error}`))
      })
      .then((file) => {
        return tauriExists(file)
      })
  }

  async getAllFiles(path: string): Promise<string[] | void> {
    // Using local file system only works from Tauri.
    if (!isTauri()) {
      return Promise.reject(
        new Error('This function can only be called from a Tauri application')
      )
    }

    return join(this.dir, path)
      .catch((error) => {
        return Promise.reject(new Error(`Error joining dir: ${error}`))
      })
      .then((p) => {
        readDirRecursive(p)
          .catch((error) => {
            return Promise.reject(new Error(`Error reading dir: ${error}`))
          })
          .then((files) => {
            return files.map((file) => file.path)
          })
      })
  }
}

export const fileSystemManager = new FileSystemManager()
