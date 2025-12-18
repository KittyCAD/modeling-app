import type { Abortable } from 'events'
import type { ObjectEncodingOptions, OpenMode } from 'fs'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import path from 'path'

import electronfs from '@src/lib/fs-zds/electronfs'
import opfs from '@src/lib/fs-zds/opfs'

/// FileSystemManager is a class that provides a way to read files from the
/// local file system. The module's singleton instance assumes that you are in a
/// project since it is solely used by the std lib when executing code.
export class FileSystemManager {
  private _fs: IZooDesignStudioFS
  private _dir: string | null = null

  constructor(fs: IZooDesignStudioFS) {
    this._fs = fs
  }

  get dir() {
    return this._dir ?? ''
  }

  set dir(dir: string) {
    this._dir = dir
  }

  get path() {
    return path
  }

  join(dir: string, targetPath: string): string {
    if (targetPath.startsWith(dir)) {
      targetPath = targetPath.slice(dir.length)
    }
    return path.join(dir, targetPath)
  }

  /**
   * Called from WASM.
   */
  async readFile(
    targetPath: string,
    options?: {
      encoding?: null | undefined
      flag?: OpenMode | undefined
    } | null
  ): Promise<Buffer>
  async readFile(
    targetPath: string,
    options:
      | {
          encoding: BufferEncoding
          flag?: OpenMode | undefined
        }
      | BufferEncoding
  ): Promise<string>
  async readFile(
    targetPath: string,
    options?:
      | (ObjectEncodingOptions &
          Abortable & {
            flag?: OpenMode | undefined
          })
      | BufferEncoding
      | null
  ): Promise<string | Buffer> {
    const filePath = this.join(this.dir, targetPath)
    const data = await this._fs.readFile(filePath, options)
    return data
  }

  /**
   * Called from WASM.
   */
  async exists(targetPath: string): Promise<boolean> {
    const file = this.join(this.dir, targetPath)
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
  async getAllFiles(targetPath: string): Promise<string[]> {
    const filepath = this.join(this.dir, targetPath)
    return await this._fs
      .readdir(filepath)
      .catch((error: Error) => {
        return Promise.reject(new Error(`Error reading dir: ${error}`))
      })
      .then((files: string[]) => {
        return files.map((filePath) => filePath)
      })
  }
}

// A similar initialization happens in @src/index.ts. It has to happen here too
// because this code runs in a web worker.
const fsInstance =
  typeof window !== 'undefined' && window.electron !== undefined
    ? electronfs.impl
    : opfs.impl

export const fsManager = new FileSystemManager(fsInstance)

/**
 * The project directory is set on this.
 */
export const projectFsManager = new FileSystemManager(fsInstance)
