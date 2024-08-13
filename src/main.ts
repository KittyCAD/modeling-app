// Some of the following was taken from bits and pieces of the vite-typescript
// template that ElectronJS provides.

import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  net,
} from 'electron'
import path from 'path'
import url from 'url'
import fs from 'node:fs/promises'
import fss from 'node:fs'
import { Issuer } from 'openid-client'
import { Bonjour, Service } from 'bonjour-service'

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit()
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    show: false,
    width: 1800,
    height: 1200,
    webPreferences: {
      nodeIntegration: false, // do not give the application implicit system access
      contextIsolation: true, // expose system functions in preload
      sandbox: false, // expose nodejs in preload
      preload: path.join(__dirname, './preload.js'),
    },
  })

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    )
  }

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()

  mainWindow.show()
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

// For now there is no good reason to separate these out to another file(s)
// There is just not enough code to warrant it and further abstracts everything
// which is already quite abstracted

ipcMain.handle('app.getPath', (event, data) => {
  return app.getPath(data)
})

ipcMain.handle('dialog.showOpenDialog', (event, data) => {
  return dialog.showOpenDialog(data)
})
ipcMain.handle('dialog.showSaveDialog', (event, data) => {
  return dialog.showSaveDialog(data)
})

ipcMain.handle('shell.showItemInFolder', (event, data) => {
  return shell.showItemInFolder(data)
})

ipcMain.handle('shell.openExternal', (event, data) => {
  return shell.openExternal(data)
})

ipcMain.handle('login', async (event, host) => {
  // Do an OAuth 2.0 Device Authorization Grant dance to get a token.
  // We quiet ts because we are not using this in the standard way.
  // @ts-ignore
  const issuer = new Issuer({
    device_authorization_endpoint: `${host}/oauth2/device/auth`,
    token_endpoint: `${host}/oauth2/device/token`,
  })
  const client = new issuer.Client({
    // We can hardcode the client ID.
    // This value is safe to be embedded in version control.
    // This is the client ID of the KittyCAD app.
    client_id: '2af127fb-e14e-400a-9c57-a9ed08d1a5b7',
    token_endpoint_auth_method: 'none',
  })

  const handle = await client.deviceAuthorization()

  // Open the system browser with the auth_uri.
  // We do this in the browser and not a separate window because we want 1password and
  // other crap to work well.
  // TODO: find a better way to share this value with tauri e2e tests
  // Here we're using an env var to enable the /tmp file (windows not supported for now)
  // and bypass the shell::open call as it fails on GitHub Actions.
  const e2e_tauri_enabled = process.env.E2E_TAURI_ENABLED
  if (e2e_tauri_enabled) {
    console.warn(
      `E2E_TAURI_ENABLED is set, won't open ${handle.verification_uri_complete} externally`
    )
    let temp = '/tmp'
    // Overwrite with Windows variable
    if (process.env.TEMP) {
      temp = process.env.TEMP
    }
    let tmpkcuc = path.join(temp, 'kittycad_user_code')
    console.log(`Writing to ${tmpkcuc}`)
    await fs.writeFile(tmpkcuc, handle.user_code)
  } else {
    shell.openExternal(handle.verification_uri_complete)
  }

  // Wait for the user to login.
  const tokenSet = await handle.poll()

  return tokenSet.access_token
})

const SERVICE_NAME = '_machine-api._tcp.local.'

ipcMain.handle('find_machine_api', () => {
  const timeoutAfterMs = 5000
  return new Promise((resolve, reject) => {
    // if it takes too long reject this promise
    setTimeout(() => resolve(null), timeoutAfterMs)
    const bonjourEt = new Bonjour({}, (error: Error) => {
      console.log('An issue with Bonjour services was encountered!')
      console.error(error)
      resolve(null)
    })
    console.log('Looking for machine API...')
    bonjourEt.find({ type: SERVICE_NAME }, (service: Service) => {
      resolve(service.fqdn)
    })
  })
})

app.whenReady().then(() => {
  protocol.handle('file', (request) => {
    const filePath = request.url.slice('file://'.length)
    const maybeAbsolutePath = path.join(__dirname, filePath)
    const bypassCustomProtocolHandlers = true
    if (fss.existsSync(maybeAbsolutePath)) {
      console.log(
        `Intercepted local-asbolute path ${filePath}, rebuilt it as ${maybeAbsolutePath}`
      )
      return net.fetch(url.pathToFileURL(maybeAbsolutePath).toString(), {
        bypassCustomProtocolHandlers,
      })
    }
    console.log(`Default fetch to ${filePath}`)
    return net.fetch(request.url, { bypassCustomProtocolHandlers })
  })
})
