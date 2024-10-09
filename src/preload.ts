import { ipcRenderer, contextBridge } from 'electron'
import path from 'path'
import fs from 'node:fs/promises'
import os from 'node:os'
import fsSync from 'node:fs'
import packageJson from '../package.json'
import { MachinesListing } from 'lib/machineManager'
import chokidar from 'chokidar'

const open = (args: any) => ipcRenderer.invoke('dialog.showOpenDialog', args)
const save = (args: any) => ipcRenderer.invoke('dialog.showSaveDialog', args)
const openExternal = (url: any) => ipcRenderer.invoke('shell.openExternal', url)
const showInFolder = (path: string) =>
  ipcRenderer.invoke('shell.showItemInFolder', path)
const startDeviceFlow = (host: string): Promise<string> =>
  ipcRenderer.invoke('startDeviceFlow', host)
const loginWithDeviceFlow = (): Promise<string> =>
  ipcRenderer.invoke('loginWithDeviceFlow')
const onUpdateDownloadStart = (
  callback: (value: { version: string }) => void
) => ipcRenderer.on('update-download-start', (_event, value) => callback(value))
const onUpdateDownloaded = (callback: (value: string) => void) =>
  ipcRenderer.on('update-downloaded', (_event, value) => callback(value))
const onUpdateError = (callback: (value: Error) => void) =>
  ipcRenderer.on('update-error', (_event, value) => callback(value))
const appRestart = () => ipcRenderer.invoke('app.restart')

const isMac = os.platform() === 'darwin'
const isWindows = os.platform() === 'win32'
const isLinux = os.platform() === 'linux'

let fsWatchListeners = new Map<string, ReturnType<typeof chokidar.watch>>()

const watchFileOn = (path: string, callback: (path: string) => void) => {
  const watcherMaybe = fsWatchListeners.get(path)
  if (watcherMaybe) return
  const watcher = chokidar.watch(path)
  watcher.on('all', callback)
  fsWatchListeners.set(path, watcher)
}
const watchFileOff = (path: string) => {
  const watcher = fsWatchListeners.get(path)
  if (!watcher) return
  watcher.unwatch(path)
  fsWatchListeners.delete(path)
}
const readFile = (path: string) => fs.readFile(path, 'utf-8')
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
const listMachines = async (): Promise<MachinesListing> => {
  const machineApi = await ipcRenderer.invoke('find_machine_api')
  if (!machineApi) return []

  return fetch(`http://${machineApi}/machines`).then((resp) => resp.json())
}

const getMachineApiIp = async (): Promise<String | null> =>
  ipcRenderer.invoke('find_machine_api')

contextBridge.exposeInMainWorld('electron', {
  startDeviceFlow,
  loginWithDeviceFlow,
  // Passing fs directly is not recommended since it gives a lot of power
  // to the browser side / potential malicious code. We restrict what is
  // exported.
  watchFileOn,
  watchFileOff,
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
  os: {
    isMac,
    isWindows,
    isLinux,
  },
  process: {
    // Setter/getter has to be created because
    // these are read-only over the boundary.
    env: Object.assign(
      {},
      exposeProcessEnvs([
        'NODE_ENV',
        'TEST_SETTINGS_FILE_KEY',
        'VITE_KC_API_WS_MODELING_URL',
        'VITE_KC_API_BASE_URL',
        'VITE_KC_SITE_BASE_URL',
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
})
