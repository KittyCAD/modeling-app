import { ipcRenderer, contextBridge } from 'electron'
import path from 'path'
import fs from 'node:fs/promises'
import packageJson from '../../package.json'

const readFile = (path: string) => fs.readFile(path, 'utf-8')
const readdir = (path: string) => fs.readdir(path, 'utf-8')
const exists = (path: string) =>
  new Promise((resolve, reject) =>
    fs.stat(path, (err, data) => {
      if (err) return reject(err.code)
      return resolve(data)
    })
  )
const getPath = async (name: string) => ipcRenderer.invoke('app.getPath', name)

contextBridge.exposeInMainWorld('electron', {
  readFile,
  readdir,
  path,
  exists,
  mkdir: fs.mkdir,
  getPath,
  packageJson,
})
