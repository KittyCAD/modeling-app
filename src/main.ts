// Some of the following was taken from bits and pieces of the vite-typescript
// template that ElectronJS provides.

import dotenv from 'dotenv'
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import { Issuer } from 'openid-client'
import { Bonjour, Service } from 'bonjour-service'
// @ts-ignore: TS1343
import * as kittycad from '@kittycad/lib/import'

// If it's not set, scream.
const NODE_ENV = process.env.NODE_ENV
if (!NODE_ENV) {
  console.error('*FOX SCREAM* process.env.NODE_ENV is not explicitly set!')
  process.exit(1)
}
dotenv.config({ path: [`.env.${NODE_ENV}.local`, `.env.${NODE_ENV}`] })

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
    icon: path.resolve(process.cwd(), 'assets', 'icon'),
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

  shell.openExternal(handle.verification_uri_complete)

  // Wait for the user to login.
  try {
    console.log('Polling for token')
    const tokenSet = await handle.poll()
    console.log('Received token set')
    console.log(tokenSet)
    return tokenSet.access_token
  } catch (e) {
    console.log(e)
  }

  return Promise.reject(new Error('No access token received'))
})

ipcMain.handle('kittycad', (event, data) => {
  return data.access
    .split('.')
    .reduce(
      (obj: any, prop: any) => obj[prop],
      kittycad
    )(data.args)
})

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
    bonjourEt.find(
      { protocol: 'tcp', type: 'machine-api' },
      (service: Service) => {
        console.log('Found machine API!', JSON.stringify(service))
        if (!service.addresses || service.addresses?.length === 0) {
          console.log('No addresses found for machine API!')
          return resolve(null)
        }
        const ip = service.addresses[0]
        const port = service.port
        // We want to return the ip address of the machine API.
        resolve(`${ip}:${port}`)
      }
    )
  })
})
