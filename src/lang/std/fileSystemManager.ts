import { isDesktop } from 'lib/isDesktop'

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

  async join(dir: string, path: string): Promise<string> {
    return Promise.resolve(window.electron.path.join(dir, path))
  }

  async readFile(path: string): Promise<Uint8Array> {
    // Using local file system only works from desktop.
    if (!isDesktop()) {
      return Promise.reject(
        new Error(
          'This function can only be called from the desktop application'
        )
      )
    }

    return this.join(this.dir, path).then((filePath) => {
      return window.electron.readFile(filePath)
    })
  }

  async exists(path: string): Promise<boolean | void> {
    // Using local file system only works from desktop.
    if (!isDesktop()) {
      return Promise.reject(
        new Error(
          'This function can only be called from the desktop application'
        )
      )
    }

    return this.join(this.dir, path).then(async (file) => {
      try {
        await window.electron.stat(file)
      } catch (e) {
        if (e === 'ENOENT') {
          return false
        }
      }
      return true
    })
  }

  async getAllFiles(path: string): Promise<string[] | void> {
    // Using local file system only works from desktop.
    if (!isDesktop()) {
      return Promise.reject(
        new Error(
          'This function can only be called from the desktop application'
        )
      )
    }

    return this.join(this.dir, path).then((filepath) => {
      return window.electron
        .readdir(filepath)
        .catch((error: Error) => {
          return Promise.reject(new Error(`Error reading dir: ${error}`))
        })
        .then((files: string[]) => {
          return files.map((filePath) => filePath)
        })
    })
  }
}

export const fileSystemManager = new FileSystemManager()
