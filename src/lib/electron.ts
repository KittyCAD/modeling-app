import { ipcRenderer, contextBridge } from 'electron'
import path from 'path'
import fs from 'node:fs/promises'
import packageJson from '../../package.json'

const readFile = (path: string) => fs.readFile(path, 'utf-8')
const writeFile = (path: string, data: string) =>
  fs.writeFile(path, data, 'utf-8')
const readdir = (path: string) => fs.readdir(path, 'utf-8')
const stat = (path: string) => fs.stat(path).catch((e) => Promise.reject(e.code))
// Electron has behavior where it doesn't clone the prototype chain over.
// So we need to call stat.isDirectory on this side.
const statIsDirectory = (path: string) => stat(path).then((res) => res.isDirectory())
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

import('@kittycad/lib').then((kittycad) => {
  contextBridge.exposeInMainWorld('electron', {
    readFile,
    writeFile,
    readdir,
    path,
    stat,
    statIsDirectory,
    mkdir: fs.mkdir,
    getPath,
    packageJson,
    platform: process.platform,
    process: {
      // Setter/getter has to be created because
      // these are read-only over the boundary.
      env: Object.assign({}, exposeProcessEnv('BASE_URL')),
    },
    kittycad: {
      users: kittycad.users,
    },
  })
})
