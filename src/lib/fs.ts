const { app, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

app.whenReady().then(() => {
  ipcMain.handle('readFile', async (event) => {
    return fs.readFile(event.data[0], 'utf-8')
  })
  ipcMain.handle('readdir', async (event) => {
    return fs.readdir(event.data[0], 'utf-8')
  })
  ipcMain.handle('join', async (event) => {
    return path.join(event.data[0])
  })
  ipcMain.handle('exists', async (event) => {
    return fs.exists(event.data[0])
  })
})
