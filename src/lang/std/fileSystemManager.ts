// Polyfill window.electron fs functions as needed when in a nodejs context
// (INTENDED FOR VITEST SHINANGANS.)
if (process.env.NODE_ENV === 'test' && process.env.VITEST) {
  const fs = require('node:fs/promises')
  const path = require('node:path')
  Object.assign(window, {
    electron: {
      readFile: fs.readFile,
      stat: fs.stat,
      readdir: fs.readdir,
      path,
      process: {},
    },
  })
}

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
    if (path.startsWith(dir)) {
      path = path.slice(dir.length)
    }
    return Promise.resolve(window.electron.path.join(dir, path))
  }

  async readFile(path: string): Promise<Uint8Array> {
    // Using local file system only works from desktop and nodejs
    if (!window?.electron?.readFile) {
      return Promise.reject(new Error('No polyfill found for this function'))
    }

    return this.join(this.dir, path).then((filePath) => {
      return window.electron.readFile(filePath)
    })
  }

  async exists(path: string): Promise<boolean | void> {
    // Using local file system only works from desktop.
    if (!window?.electron?.stat) {
      return Promise.reject(new Error('No polyfill found for this function'))
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
    if (!window?.electron?.readdir) {
      return Promise.reject(new Error('No polyfill found for this function'))
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
