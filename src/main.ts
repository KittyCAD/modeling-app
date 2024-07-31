// Some of the following was taken from bits and pieces of the vite-typescript
// template that ElectronJS provides.

import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import { Issuer } from 'openid-client'

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit()
}

const createWindow = () => {
  let mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    width: 800,
    height: 600,
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

ipcMain.handle('app.getPath', (event, data) => {
  return app.getPath(data)
})

ipcMain.handle('dialog', (event, data) => {
  return dialog.showOpenDialog(data)
})

ipcMain.handle('shell.showItemInFolder', (event, data) => {
  return shell.showItemInFolder(data)
})

ipcMain.handle('shell.openExternal', (event, data) => {
  return shell.openExternal(data)
})

ipcMain.handle('login', async (event, host) => {
    console.log('Logging in...')
    // Do an OAuth 2.0 Device Authorization Grant dance to get a token.
    const issuer = new Issuer({
      device_authorization_endpoint: `${host}/oauth2/device/auth`,
      token_endpoint: `${host}/oauth2/device/token`,
    })
    const client = new issuer.Client({
      // We can hardcode the client ID.
      // This value is safe to be embedded in version control.
      // This is the client ID of the KittyCAD app.
      client_id: "2af127fb-e14e-400a-9c57-a9ed08d1a5b7",
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
        console.warn(`E2E_TAURI_ENABLED is set, won't open ${handle.verification_uri_complete} externally`)
        let temp = '/tmp'
        // Overwrite with Windows variable
        if (process.env.TEMP) {
          temp = process.env.TEMP
        }
        let path = path.join(temp, "kittycad_user_code")
        console.log(`Writing to ${path}`)
        await fs.writeFile(path, handle.user_code)
    } else {
        shell.openExternal(handle.verification_uri_complete)
    }

    // Wait for the user to login.
    const tokenSet = await handle.poll()

    return tokenSet.access_token
})
