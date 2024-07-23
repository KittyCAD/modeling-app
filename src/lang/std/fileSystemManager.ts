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
    return window.electron.ipcRenderer.invoke('join', [dir, path]);
  }

  async readFile(path: string): Promise<Uint8Array | void> {
    // Using local file system only works from desktop.
    if (!isDesktop()) {
      return Promise.reject(
        new Error('This function can only be called from the desktop application')
      )
    }

    return this.join(this.dir, path)
      .catch((error) => {
        return Promise.reject(new Error(`Error reading file: ${error}`))
      })
      .then((file) => {
        return window.electron.ipcRenderer.invoke('readFile', [filepath])
      })
  }

  async exists(path: string): Promise<boolean | void> {
    // Using local file system only works from desktop.
    if (!isDesktop()) {
      return Promise.reject(
        new Error('This function can only be called from the desktop application')
      )
    }

    return this.join(this.dir, path)
      .catch((error) => {
        return Promise.reject(new Error(`Error checking file exists: ${error}`))
      })
      .then((file) => {
        return window.electron.ipcRenderer.invoke('exists', [file])
      })
  }

  async getAllFiles(path: string): Promise<string[] | void> {
    // Using local file system only works from desktop.
    if (!isDesktop()) {
      return Promise.reject(
        new Error('This function can only be called from the desktop application')
      )
    }

    return this.join(this.dir, path)
      .catch((error) => {
        return Promise.reject(new Error(`Error joining dir: ${error}`))
      })
      .then((filepath) => {
        return window.electron.ipcRenderer.invoke('readdir', [filepath])
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
