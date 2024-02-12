import {
  readBinaryFile,
  exists as tauriExists,
  BaseDirectory,
} from '@tauri-apps/api/fs'
import { isTauri } from 'lib/isTauri'
import { join } from '@tauri-apps/api/path'

/// FileSystemManager is a class that provides a way to read files from the local file system.
/// It assumes that you are in a project since it is solely used by the std lib
/// when executing code.
class FileSystemManager {
  currentProjectDir: string | null = null

  setCurrentProjectDir(dir: string) {
    this.currentProjectDir = dir
  }

  getCurrentProjectDir() {
    if (this.currentProjectDir === null) {
      throw new Error('currentProjectDir is not set')
    }
    return this.currentProjectDir
  }

  readFile(path: string): Promise<Uint8Array | void> {
    // Using local file system only works from Tauri.
    if (!isTauri()) {
      throw new Error(
        'This function can only be called from a Tauri application'
      )
    }

    if (this.currentProjectDir === null) {
      throw new Error('currentProjectDir is not set')
    }

    return join(this.currentProjectDir, path)
      .catch((error) => {
        throw new Error(`Error reading file: ${error}`)
      })
      .then((file) => {
        readBinaryFile(file)
      })
  }

  exists(path: string): Promise<boolean | void> {
    // Using local file system only works from Tauri.
    if (!isTauri()) {
      throw new Error(
        'This function can only be called from a Tauri application'
      )
    }

    if (this.currentProjectDir === null) {
      throw new Error('currentProjectDir is not set')
    }

    return join(this.currentProjectDir, path)
      .catch((error) => {
        throw new Error(`Error checking file exists: ${error}`)
      })
      .then((file) => {
        tauriExists(file)
      })
  }
}

export const fileSystemManager = new FileSystemManager()
