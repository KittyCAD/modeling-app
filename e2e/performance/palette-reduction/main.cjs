'use strict'
const path = require('node:path')
const { app, BrowserWindow, nativeTheme, session } = require('electron')

if (!process.env.PALETTE_REDUCTION_PROFILE) {
  throw new Error('A dedicated reduction profile is required.')
}
app.setPath('userData', process.env.PALETTE_REDUCTION_PROFILE)
app.setPath('sessionData', process.env.PALETTE_REDUCTION_PROFILE)
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({
      cancel:
        !details.url.startsWith('file:') &&
        !details.url.startsWith('devtools:'),
    })
  })
  const window = new BrowserWindow({
    autoHideMenuBar: false,
    show: false,
    enableLargerThanScreen: true,
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    frame: process.platform !== 'darwin',
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1C1C1C' : '#FCFCFC',
  })
  window.on('ready-to-show', () => window.show())
  window.loadFile(path.join(__dirname, 'index.html'))
})
app.on('window-all-closed', () => app.quit())
