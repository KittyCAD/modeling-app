import fs from 'node:fs/promises'
import path from 'path'
import { dialog, shell } from 'electron'

export interface IElectronAPI {
  open: typeof dialog.showOpenDialog
  save: typeof dialog.showSaveDialog
  openExternal: typeof shell.openExternal
  showInFolder: typeof shell.showItemInFolder
  login: (host: string) => Promise<string>
  platform: typeof process.env.platform
  arch: typeof process.env.arch
  version: typeof process.env.version
  readFile: (path: string) => ReturnType<fs.readFile>
  writeFile: (path: string, data: string | Uint8Array) => ReturnType<fs.writeFile>
  readdir: (path: string) => ReturnType<fs.readdir>
  getPath: (name: string) => Promise<string>
  rm: typeof fs.rm
  stat: (path: string) => ReturnType<fs.stat>
  statIsDirectory: (path: string) => Promise<boolean>
  path: typeof path,
  mkdir: typeof fs.mkdir,
  rename: (prev: string, next: string) => typeof fs.rename,
  packageJson: {
    name: string,
  },
  process: {
    env: {
      BASE_URL: (value?: string) => string,
    }
  }
}

declare global {
  interface Window {
    electron: IElectronAPI
  }
}
