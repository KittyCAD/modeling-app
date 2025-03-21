import { ipcRenderer, contextBridge } from 'electron'
import path from 'path'
import fs from 'node:fs/promises'
import os from 'node:os'
import fsSync from 'node:fs'
import packageJson from '../package.json'
import { MachinesListing } from 'components/MachineManagerProvider'
import chokidar from 'chokidar'

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
const stat = (path: string) =>
  fs.stat(path).catch((e) => Promise.reject(e.code))
// Electron has behavior where it doesn't clone the prototype chain over.
// So we need to call stat.isDirectory on this side.
const statIsDirectory = (path: string) =>
  stat(path).then((res) => res.isDirectory())
const getPath = async (name: string) => ipcRenderer.invoke('app.getPath', name)

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

const getMachineApiIp = async (): Promise<String | null> =>
  ipcRenderer.invoke('find_machine_api')

const getArgvParsed = () => {
  return ipcRenderer.invoke('argv.parser')
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
})
