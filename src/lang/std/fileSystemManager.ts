// Polyfill window.electron fs functions as needed when in a nodejs context
// (INTENDED FOR VITEST SHENANIGANS.)

import type { IElectronAPI } from '@root/interface'
import type { ObjectEncodingOptions, OpenMode } from 'fs'
import type { Abortable } from 'events'
// @ts-ignore This lib doesn't have types.
import * as nodePath from '@chainner/node-path'

export interface IFs {
  readdir: (path: string) => Promise<string[]>
  readFile: IElectronAPI['readFile']
  stat: (path: string) => Promise<ReturnType<IElectronAPI['stat']>>
  writeFile: IElectronAPI['writeFile']
}

let testNodeFs
if (process.env.NODE_ENV === 'test' && process.env.VITEST) {
  const fs = require('node:fs/promises')
  testNodeFs = fs
}

/// FileSystemManager is a class that provides a way to read files from the
/// local file system. The module's singleton instance assumes that you are in a
/// project since it is solely used by the std lib when executing code.
export class FileSystemManager {
  private _nodePath: IElectronAPI['path']
  private _fs: IFs | undefined
  private _dir: string | null = null

  constructor(nodePath: IElectronAPI['path'], fs: IFs | undefined) {
    this._nodePath = nodePath
    this._fs = fs
  }

  get dir() {
    return this._dir ?? ''
  }

  set dir(dir: string) {
    this._dir = dir
  }

  get path() {
    return this._nodePath
  }

  join(dir: string, path: string): string {
    if (path.startsWith(dir)) {
      path = path.slice(dir.length)
    }
    return this._nodePath.join(dir, path)
  }

  /**
   * Called from WASM.
   */
  async readFile(
    path: string,
    options?: {
      encoding?: null | undefined
      flag?: OpenMode | undefined
    } | null
  ): Promise<Buffer>
  async readFile(
    path: string,
    options:
      | {
          encoding: BufferEncoding
          flag?: OpenMode | undefined
        }
      | BufferEncoding
  ): Promise<string>
  async readFile(
    path: string,
    options?:
      | (ObjectEncodingOptions &
          Abortable & {
            flag?: OpenMode | undefined
          })
      | BufferEncoding
      | null
  ): Promise<string | Buffer> {
    // Using local file system only works from desktop and nodejs
    if (!this._fs) {
      return Promise.reject(new Error('No polyfill found for this function'))
    }

    const filePath = this.join(this.dir, path)
    return this._fs.readFile(filePath, options)
  }

  /**
   * Called from WASM.
   */
  async exists(path: string): Promise<boolean> {
    // Using local file system only works from desktop.
    if (!this._fs) {
      return Promise.reject(new Error('No polyfill found for this function'))
    }

    const file = this.join(this.dir, path)
    try {
      await this._fs.stat(file)
    } catch (e) {
      if (e === 'ENOENT') {
        return false
      }
    }
    return true
  }

  /**
   * Called from WASM.
   */
  async getAllFiles(path: string): Promise<string[] | void> {
    // Using local file system only works from desktop.
    if (!this._fs) {
      return Promise.reject(new Error('No polyfill found for this function'))
    }

    const filepath = this.join(this.dir, path)
    return await this._fs
      .readdir(filepath)
      .catch((error: Error) => {
        return Promise.reject(new Error(`Error reading dir: ${error}`))
      })
      .then((files: string[]) => {
        return files.map((filePath) => filePath)
      })
  }

  async stat(path: string): Promise<ReturnType<IElectronAPI['stat']>> {
    // Using local file system only works from desktop.
    if (!this._fs) {
      return Promise.reject(new Error('No polyfill found for this function'))
    }

    return await this._fs.stat(this.join(this.dir, path))
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    // Using local file system only works from desktop and nodejs
    if (!this._fs) {
      return Promise.reject(new Error('No polyfill found for this function'))
    }

    const filePath = this.join(this.dir, path)
    this._fs.writeFile(filePath, data)
  }
}

const fsInstance =
  (typeof window !== 'undefined' ? window.electron : undefined) ?? testNodeFs
export const fsManager = new FileSystemManager(nodePath, fsInstance)

/**
 * The project directory is set on this.
 */
export const projectFsManager = new FileSystemManager(nodePath, fsInstance)
