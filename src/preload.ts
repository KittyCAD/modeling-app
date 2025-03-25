import packageJson from '@root/package.json'
import type { MachinesListing } from '@src/components/MachineManagerProvider'
import chokidar from 'chokidar'
import type { IpcRendererEvent } from 'electron'
import { contextBridge, ipcRenderer } from 'electron'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'path'

import type { Channel } from '@src/channels'
import type { WebContentSendPayload } from '@src/menu/channels'

const typeSafeIpcRendererOn = (
  channel: Channel,
  listener: (event: IpcRendererEvent, ...args: any[]) => void
) => ipcRenderer.on(channel, listener)

const resizeWindow = (width: number, height: number) =>
  ipcRenderer.invoke('app.resizeWindow', [width, height])
const open = (args: any) => ipcRenderer.invoke('dialog.showOpenDialog', args)
const save = (args: any) => ipcRenderer.invoke('dialog.showSaveDialog', args)
const openExternal = (url: any) => ipcRenderer.invoke('shell.openExternal', url)
const takeElectronWindowScreenshot = ({
  width,
  height,
}: {
  width: number
  height: number
}) => ipcRenderer.invoke('take.screenshot', { width, height })
const showInFolder = (path: string) =>
  ipcRenderer.invoke('shell.showItemInFolder', path)
const startDeviceFlow = (host: string): Promise<string> =>
  ipcRenderer.invoke('startDeviceFlow', host)
const loginWithDeviceFlow = (): Promise<string> =>
  ipcRenderer.invoke('loginWithDeviceFlow')
const onUpdateDownloaded = (
  callback: (value: { version: string; releaseNotes: string }) => void
) =>
  ipcRenderer.on('update-downloaded', (_event: any, value) => callback(value))
const onUpdateDownloadStart = (
  callback: (value: { version: string }) => void
) =>
  ipcRenderer.on('update-download-start', (_event: any, value) =>
    callback(value)
  )
const onUpdateError = (callback: (value: Error) => void) =>
  ipcRenderer.on('update-error', (_event: any, value) => callback(value))
const appRestart = () => ipcRenderer.invoke('app.restart')
const appCheckForUpdates = () => ipcRenderer.invoke('app.checkForUpdates')
const getAppTestProperty = (propertyName: string) =>
  ipcRenderer.invoke('app.testProperty', propertyName)

const isMac = os.platform() === 'darwin'
const isWindows = os.platform() === 'win32'
const isLinux = os.platform() === 'linux'

let fsWatchListeners = new Map<
  string,
  Map<
    string,
    {
      watcher: ReturnType<typeof chokidar.watch>
      callback: (eventType: string, path: string) => void
    }
  >
>()

const watchFileOn = (
  path: string,
  key: string,
  callback: (eventType: string, path: string) => void
) => {
  let watchers = fsWatchListeners.get(path)
  if (!watchers) {
    watchers = new Map()
  }
  const watcher = chokidar.watch(path, { depth: 1 })
  watcher.on('all', callback)
  watchers.set(key, { watcher, callback })
  fsWatchListeners.set(path, watchers)
}
const watchFileOff = (path: string, key: string) => {
  const watchers = fsWatchListeners.get(path)
  if (!watchers) return
  const data = watchers.get(key)
  if (!data) {
    console.warn(
      "Trying to remove a watcher, callback that doesn't exist anymore. Suspicious."
    )
    return
  }
  const { watcher, callback } = data
  watcher.off('all', callback)
  watchers.delete(key)
  if (watchers.size === 0) {
    fsWatchListeners.delete(path)
  } else {
    fsWatchListeners.set(path, watchers)
  }
}
const readFile = fs.readFile
// It seems like from the node source code this does not actually block but also
// don't trust me on that (jess).
const exists = (path: string) => fsSync.existsSync(path)
const rename = (prev: string, next: string) => fs.rename(prev, next)
const writeFile = (path: string, data: string | Uint8Array) =>
  fs.writeFile(path, data, 'utf-8')
const readdir = (path: string) => fs.readdir(path, 'utf-8')
const stat = (path: string) => {
  return fs.stat(path).catch((e) => Promise.reject(e.code))
}

// Electron has behavior where it doesn't clone the prototype chain over.
// So we need to call stat.isDirectory on this side.
const statIsDirectory = (path: string) =>
  stat(path).then((res) => res.isDirectory())
const getPath = async (name: string) => ipcRenderer.invoke('app.getPath', name)

const canReadWriteDirectory = async (
  path: string
): Promise<{ value: boolean; error: unknown } | Error> => {
  const isDirectory = await statIsDirectory(path)
  if (!isDirectory) {
    return new Error('path is not a directory. Do not send a file path.')
  }

  // bitwise OR to check read and write permissions
  try {
    const canReadWrite = await fs.access(
      path,
      fs.constants.R_OK | fs.constants.W_OK
    )
    // This function returns undefined. If it cannot access the path it will throw an error
    return canReadWrite === undefined
      ? { value: true, error: undefined }
      : { value: false, error: undefined }
  } catch (e) {
    console.error(e)
    return { value: false, error: e }
  }
}

const exposeProcessEnvs = (varNames: Array<string>) => {
  const envs: Record<string, string> = {}
  varNames.forEach((varName) => {
    const envVar = process.env[varName]
    if (envVar) {
      envs[varName] = envVar
    }
  })
  return envs
}

const kittycad = (access: string, args: any) =>
  ipcRenderer.invoke('kittycad', { access, args })

// We could probably do this from the renderer side, but I fear CORS will
// bite our butts.
const listMachines = async (
  machineApiAddr: string
): Promise<MachinesListing> => {
  return fetch(`http://${machineApiAddr}/machines`).then((resp) => {
    return resp.json()
  })
}

const getMachineApiIp = async (): Promise<string | null> =>
  ipcRenderer.invoke('find_machine_api')

const getArgvParsed = () => {
  return ipcRenderer.invoke('argv.parser')
}

// Creating a menu will refresh the state of the menu
// Anything that was enabled will be reset to the hard coded state of the original menu
const createHomePageMenu = async (): Promise<any> => {
  return ipcRenderer.invoke('create-menu', { page: 'project' })
}

// Creating a menu will refresh the state of the menu
// Anything that was enabled will be reset to the hard coded state of the original menu
const createModelingPageMenu = async (): Promise<any> => {
  return ipcRenderer.invoke('create-menu', { page: 'modeling' })
}

// Creating a menu will refresh the state of the menu
// Anything that was enabled will be reset to the hard coded state of the original menu
const createFallbackMenu = async (): Promise<any> => {
  return ipcRenderer.invoke('create-menu', { page: 'fallback' })
}

// Given the application menu, try to enable the menu
const enableMenu = async (menuId: string): Promise<any> => {
  return ipcRenderer.invoke('enable-menu', {
    menuId,
  })
}

// Given the application menu, try to disable the menu
const disableMenu = async (menuId: string): Promise<any> => {
  return ipcRenderer.invoke('disable-menu', {
    menuId,
  })
}

/**
 * Gotcha: Even if the callback function is the same function in JS memory
 * when passing it over the IPC layer it will not map to the same function.
 * this means your .on and .off with the same callback function in memory will
 * not be removed.
 * To remove the listener call the return value of menuOn. It builds a closure
 * of the subscription on the electron side and it will let you remove the listener correctly.
 */
const menuOn = (callback: (payload: WebContentSendPayload) => void) => {
  // Build a new subscription function for the closure below
  const subscription = (event: IpcRendererEvent, data: WebContentSendPayload) =>
    callback(data)
  typeSafeIpcRendererOn('menu-action-clicked', subscription)

  // This is the only way to remove the event listener from the JS side
  return () => {
    ipcRenderer.removeListener('menu-action-clicked', subscription)
  }
}

contextBridge.exposeInMainWorld('electron', {
  startDeviceFlow,
  loginWithDeviceFlow,
  // Passing fs directly is not recommended since it gives a lot of power
  // to the browser side / potential malicious code. We restrict what is
  // exported.
  watchFileOn,
  watchFileOff,
  copyFile: fs.copyFile,
  readFile,
  writeFile,
  exists,
  readdir,
  rename,
  rm: fs.rm,
  path,
  stat,
  statIsDirectory,
  mkdir: fs.mkdir,
  // opens a dialog
  open,
  save,
  // opens the URL
  openExternal,
  showInFolder,
  getPath,
  packageJson,
  arch: process.arch,
  platform: process.platform,
  version: process.version,
  join: path.join,
  sep: path.sep,
  takeElectronWindowScreenshot,
  os: {
    isMac,
    isWindows,
    isLinux,
  },
  // Use this to access dynamic properties from the node side.
  // INTENDED ONLY TO BE USED FOR TESTS.
  getAppTestProperty,
  process: {
    // These are read-only over the boundary.
    env: Object.assign(
      {},
      exposeProcessEnvs([
        'NODE_ENV',
        'VITE_KC_API_WS_MODELING_URL',
        'VITE_KC_API_BASE_URL',
        'VITE_KC_SITE_BASE_URL',
        'VITE_KC_SITE_APP_URL',
        'VITE_KC_SKIP_AUTH',
        'VITE_KC_CONNECTION_TIMEOUT_MS',
        'VITE_KC_DEV_TOKEN',

        'IS_PLAYWRIGHT',
        'TEST_SETTINGS_FILE_KEY',

        // Really we shouldn't use these and our code should use NODE_ENV
        'DEV',
        'PROD',
        'TEST',
        'CI',
      ])
    ),
  },
  kittycad,
  listMachines,
  getMachineApiIp,
  onUpdateDownloadStart,
  onUpdateDownloaded,
  onUpdateError,
  appRestart,
  appCheckForUpdates,
  getArgvParsed,
  resizeWindow,
  createHomePageMenu,
  createModelingPageMenu,
  createFallbackMenu,
  enableMenu,
  disableMenu,
  menuOn,
  canReadWriteDirectory,
})
