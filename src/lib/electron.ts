import { ipcRenderer, contextBridge } from 'electron'
import path from 'path'
import fs from 'node:fs/promises'
import packageJson from '../../package.json'
import { components } from 'lib/machine-api'
import { MachinesListing } from 'lib/machineManager'

const open = (args: any) => ipcRenderer.invoke('dialog.showOpenDialog', args)
const save = (args: any) => ipcRenderer.invoke('dialog.showSaveDialog', args)
const openExternal = (url: any) => ipcRenderer.invoke('shell.openExternal', url)
const showInFolder = (path: string) =>
  ipcRenderer.invoke('shell.showItemInFolder', path)
const login = (host: string): Promise<string> =>
  ipcRenderer.invoke('login', host)

const readFile = (path: string) => fs.readFile(path, 'utf-8')
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

const exposeProcessEnv = (varName: string) => {
  return {
    [varName](value?: string) {
      if (value !== undefined) {
        process.env[varName] = value
      } else {
        return process.env[varName]
      }
    },
  }
}

// We could probably do this from the renderer side, but I fear CORS will
// bite our butts.
const listMachines = async (): Promise<MachinesListing> => {
  const machineApi = await ipcRenderer.invoke('find_machine_api')
  if (!machineApi) return {}

  return fetch(`http://${machineApi}/machines`).then((resp) => resp.json())
}

const getMachineApiIp = async (): Promise<String | null> =>
  ipcRenderer.invoke('find_machine_api')

import('@kittycad/lib').then((kittycad) => {
  contextBridge.exposeInMainWorld('electron', {
    login,
    // Passing fs directly is not recommended since it gives a lot of power
    // to the browser side / potential malicious code. We restrict what is
    // exported.
    readFile,
    writeFile,
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
    process: {
      // Setter/getter has to be created because
      // these are read-only over the boundary.
      env: Object.assign({}, exposeProcessEnv('BASE_URL')),
    },
    kittycad: {
      users: kittycad.users,
    },
    listMachines,
    getMachineApiIp,
  })
})
