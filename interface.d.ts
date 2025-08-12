import { MachinesListing } from 'components/MachineManagerProvider'
import 'electron'
import fs from 'node:fs/promises'
import path from 'path'
import { dialog, shell } from 'electron'
import type { WebContentSendPayload } from 'menu/channels'
import { ZooLabel } from 'menu/roles'

// Extend the interface with additional custom properties
declare module 'electron' {
  interface Menu {
    label?: ZooLabel
  }
}

type EnvFn = (value?: string) => string

export interface IElectronAPI {
  resizeWindow: (width: number, height: number) => Promise<void>
  open: typeof dialog.showOpenDialog
  save: typeof dialog.showSaveDialog
  openExternal: typeof shell.openExternal
  openInNewWindow: (name: string) => void
  takeElectronWindowScreenshot: ({
    width,
    height,
  }: {
    width: number
    height: number
  }) => Promise<string>
  showInFolder: typeof shell.showItemInFolder
  /** Require to be called first before {@link loginWithDeviceFlow} */
  startDeviceFlow: (host: string) => Promise<string>
  /** Registered by first calling {@link startDeviceFlow}, which sets up the device flow handle */
  loginWithDeviceFlow: () => Promise<string>
  platform: typeof process.env.platform
  arch: typeof process.env.arch
  version: typeof process.env.version
  watchFileOn: (
    path: string,
    key: string,
    callback: (eventType: string, path: string) => void
  ) => void
  readFile: typeof fs.readFile
  copyFile: typeof fs.copyFile
  watchFileOff: (path: string, key: string) => void
  writeFile: (
    path: string,
    data: string | Uint8Array
  ) => ReturnType<typeof fs.writeFile>
  readdir: (path: string) => Promise<string[]>
  // This is synchronous.
  exists: (path: string) => boolean
  getPath: (name: string) => Promise<string>
  rm: typeof fs.rm
  // TODO: Use a real return type.
  stat: (path: string) => Promise<any>
  statIsDirectory: (path: string) => Promise<boolean>
  canReadWriteDirectory: (
    path: string
  ) => Promise<{ value: boolean; error: unknown }>
  path: typeof path
  mkdir: typeof fs.mkdir
  join: typeof path.join
  sep: typeof path.sep
  rename: (prev: string, next: string) => ReturnType<typeof fs.rename>
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
      NODE_ENV: string
      VITE_KITTYCAD_BASE_DOMAIN: string
      VITE_KITTYCAD_API_WEBSOCKET_URL: string
      VITE_KITTYCAD_API_TOKEN: string
    }
  }
  kittycad: (access: string, args: any) => any
  listMachines: (machineApiIp: string) => Promise<MachinesListing>
  getMachineApiIp: () => Promise<string | null>
  onUpdateChecking: (callback: () => void) => Electron.IpcRenderer
  onUpdateNotAvailable: (callback: () => void) => Electron.IpcRenderer
  onUpdateDownloadStart: (
    callback: (value: { version: string }) => void
  ) => Electron.IpcRenderer
  onUpdateDownloaded: (
    callback: (value: { version: string; releaseNotes: string }) => void
  ) => Electron.IpcRenderer
  onUpdateError: (callback: (value: { error: Error }) => void) => Electron
  appRestart: () => void
  appCheckForUpdates: () => Promise<unknown>
  getArgvParsed: () => any
  getAppTestProperty: (propertyName: string) => any

  // Helper functions to create application Menus
  createHomePageMenu: () => Promise<any>
  createModelingPageMenu: () => Promise<any>
  createFallbackMenu: () => Promise<any>
  enableMenu(menuId: string): Promise<any>
  disableMenu(menuId: string): Promise<any>
  menuOn: (callback: (payload: WebContentSendPayload) => void) => any
}

declare global {
  interface Window {
    electron: IElectronAPI
    openExternalLink: (e: React.MouseEvent<HTMLAnchorElement>) => void
  }
}
