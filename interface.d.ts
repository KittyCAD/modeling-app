import fs from 'node:fs/promises'
import path from 'path'
import { dialog, shell } from 'electron'
import { MachinesListing } from 'lib/machineManager'

type EnvFn = (value?: string) => string

export interface IElectronAPI {
  open: typeof dialog.showOpenDialog
  save: typeof dialog.showSaveDialog
  openExternal: typeof shell.openExternal
  showInFolder: typeof shell.showItemInFolder
  /** Require to be called first before {@link loginWithDeviceFlow} */
  startDeviceFlow: (host: string) => Promise<string>
  /** Registered by first calling {@link startDeviceFlow}, which sets up the device flow handle */
  loginWithDeviceFlow: () => Promise<string>
  platform: typeof process.env.platform
  arch: typeof process.env.arch
  version: typeof process.env.version
  readFile: (path: string) => ReturnType<fs.readFile>
  writeFile: (
    path: string,
    data: string | Uint8Array
  ) => ReturnType<fs.writeFile>
  readdir: (path: string) => ReturnType<fs.readdir>
  exists: (path: string) => ReturnType<fs.exists>
  getPath: (name: string) => Promise<string>
  rm: typeof fs.rm
  stat: (path: string) => ReturnType<fs.stat>
  statIsDirectory: (path: string) => Promise<boolean>
  path: typeof path
  mkdir: typeof fs.mkdir
  join: typeof path.join
  sep: typeof path.sep
  rename: (prev: string, next: string) => typeof fs.rename
  packageJson: {
    name: string
  }
  os: {
    isMac: boolean
    isWindows: boolean
    isLinux: boolean
  }
  process: {
    env: {
      BASE_URL: string
      TEST_SETTINGS_FILE_KEY: string
      IS_PLAYWRIGHT: string
      VITE_KC_DEV_TOKEN: string
      VITE_KC_API_WS_MODELING_URL: string
      VITE_KC_API_BASE_URL: string
      VITE_KC_SITE_BASE_URL: string
      VITE_KC_SKIP_AUTH: string
      VITE_KC_CONNECTION_TIMEOUT_MS: string
      VITE_KC_DEV_TOKEN: string
      NODE_ENV: string
      PROD: string
      DEV: string
      TEST: string
      CI: string
    }
  }
  kittycad: (access: string, args: any) => any
  listMachines: () => Promise<MachinesListing>
  getMachineApiIp: () => Promise<string | null>
  onUpdateDownloaded: (
    callback: (value: string) => void
  ) => Electron.IpcRenderer
  appRestart: () => void
}

declare global {
  interface Window {
    electron: IElectronAPI
  }
}
