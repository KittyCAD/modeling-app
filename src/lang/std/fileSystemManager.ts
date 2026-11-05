import type { FileReadOperations } from '@src/lib/fileSystem/workerBridge'
import type { Abortable } from 'events'
import type { ObjectEncodingOptions, OpenMode } from 'fs'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

import electronfs from '@src/lib/fs-zds/electronfs'
import opfs from '@src/lib/fs-zds/opfs'

/// FileSystemManager is a class that provides a way to read files from the
/// local file system. The module's singleton instance assumes that you are in a
/// project since it is solely used by the std lib when executing code.
export class FileSystemManager {
  private _fs: IZooDesignStudioFS
  private operations: FileReadOperations
  private _dir: string | null = null

  constructor(fs: IZooDesignStudioFS) {
    this._fs = fs
    this.operations = {
      readFile: (path) => fs.readFile(path),
      exists: async (path) => {
        try {
          await fs.stat(path)
          return true
        } catch (error) {
          if (
            error === 'ENOENT' ||
            (error &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === 'ENOENT')
          )
            return false
          return Promise.reject(error)
        }
      },
      readDirectory: (path) => fs.readdir(path),
    }
  }

  setOperations(operations: FileReadOperations) {
    this.operations = operations
  }

  get dir() {
    return this._dir ?? ''
  }

  set dir(dir: string) {
    this._dir = dir
  }

  get path() {
    return {
      resolve: this._fs.resolve,
      join: this._fs.join,
      relative: this._fs.relative,
      extname: this._fs.extname,
      sep: this._fs.sep,
      basename: this._fs.basename,
      dirname: this._fs.dirname,
    }
  }

  join(dir: string, targetPath: string): string {
    if (targetPath.startsWith(dir)) {
      targetPath = targetPath.slice(dir.length)
    }
    return this._fs.join(dir, targetPath)
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
  ): Promise<string | Uint8Array<ArrayBufferLike>> {
    const filePath = this.join(this.dir, targetPath)
    const data = await this.operations.readFile(filePath)
    const encoding = typeof options === 'string' ? options : options?.encoding
    return encoding ? new TextDecoder(encoding).decode(data) : data
  }

  /**
   * Called from WASM.
   */
  async exists(targetPath: string): Promise<boolean> {
    const file = this.join(this.dir, targetPath)
    return this.operations.exists(file)
  }

  /**
   * Called from WASM.
   */
  async getAllFiles(targetPath: string): Promise<string[]> {
    const filepath = this.join(this.dir, targetPath)
    return [...(await this.operations.readDirectory(filepath))]
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
