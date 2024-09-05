// Some of the following was taken from bits and pieces of the vite-typescript
// template that ElectronJS provides.

import dotenv from 'dotenv'
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import { Issuer } from 'openid-client'
import { Bonjour, Service } from 'bonjour-service'
// @ts-ignore: TS1343
import * as kittycad from '@kittycad/lib/import'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import minimist from 'minimist'
import getCurrentProjectFile from 'lib/getCurrentProjectFile'
import os from 'node:os'

let mainWindow: BrowserWindow | null = null

// Check the command line arguments for a project path
const args = parseCLIArgs()

// If it's not set, scream.
const NODE_ENV = process.env.NODE_ENV || 'production'
if (!process.env.NODE_ENV)
  console.warn(
    '*FOX SCREAM* process.env.NODE_ENV is not explicitly set!, defaulting to production'
  )
// Default prod values

// dotenv override when present
dotenv.config({ path: [`.env.${NODE_ENV}.local`, `.env.${NODE_ENV}`] })

console.log(process.env)

process.env.VITE_KC_API_WS_MODELING_URL ??=
  'wss://api.zoo.dev/ws/modeling/commands'
process.env.VITE_KC_API_BASE_URL ??= 'https://api.zoo.dev'
process.env.VITE_KC_SITE_BASE_URL ??= 'https://zoo.dev'
process.env.VITE_KC_SKIP_AUTH ??= 'false'
process.env.VITE_KC_CONNECTION_TIMEOUT_MS ??= '15000'

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit()
}

const ZOO_STUDIO_PROTOCOL = 'zoo-studio'

/// Register our application to handle all "electron-fiddle://" protocols.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(ZOO_STUDIO_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ])
  }
} else {
  app.setAsDefaultProtocolClient(ZOO_STUDIO_PROTOCOL)
}

// Global app listeners
// Must be done before ready event.
registerStartupListeners()

const createWindow = (filePath?: string): BrowserWindow => {
  const newWindow = new BrowserWindow({
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
    icon: path.resolve(process.cwd(), 'assets', 'icon.png'),
    frame: os.platform() !== 'darwin',
    titleBarStyle: 'hiddenInset',
  })

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    newWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    getProjectPathAtStartup(filePath).then((projectPath) => {
      const startIndex = path.join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`
      )

      if (projectPath === null) {
        newWindow.loadFile(startIndex)
        return
      }

      console.log('Loading file', projectPath)

      const fullUrl = `/file/${encodeURIComponent(projectPath)}`
      console.log('Full URL', fullUrl)

      newWindow.loadFile(startIndex, {
        hash: fullUrl,
      })
    })
  }

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()

  newWindow.show()

  return newWindow
}

// Quit when all windows are closed, even on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q, but it is a really weird behavior with our app.
app.on('window-all-closed', () => {
  app.quit()
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', (event, data) => {
  // Create the mainWindow
  mainWindow = createWindow()
})

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

export function getAutoUpdater(): AppUpdater {
  // Using destructuring to access autoUpdater due to the CommonJS module of 'electron-updater'.
  // It is a workaround for ESM compatibility issues, see https://github.com/electron-userland/electron-builder/issues/7976.
  const { autoUpdater } = electronUpdater
  return autoUpdater
}

export async function checkForUpdates(autoUpdater: AppUpdater) {
  // TODO: figure out how to get the update modal back
  const result = await autoUpdater.checkForUpdatesAndNotify()
  console.log(result)
}

app.on('ready', async () => {
  const autoUpdater = getAutoUpdater()
  checkForUpdates(autoUpdater)
  const fifteenMinutes = 15 * 60 * 1000
  setInterval(() => {
    checkForUpdates(autoUpdater)
  }, fifteenMinutes)

  autoUpdater.on('update-available', (info) => {
    console.log('update-available', info)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('update-downloaded', info)
  })
})

const getProjectPathAtStartup = async (
  filePath?: string
): Promise<string | null> => {
  // If we are in development mode, we don't want to load a project at
  // startup.
  // Since the args passed are always '.'
  if (NODE_ENV !== 'production') {
    return null
  }

  let projectPath: string | null = filePath || null
  if (projectPath === null) {
    // macOS: open-file events that were received before the app is ready
    const macOpenFiles: string[] = (global as any).macOpenFiles
    if (macOpenFiles && macOpenFiles && macOpenFiles.length > 0) {
      projectPath = macOpenFiles[0] // We only do one project at a time
    }
    // Reset this so we don't accidentally use it again.
    const macOpenFilesEmpty: string[] = []
    // @ts-ignore
    global['macOpenFiles'] = macOpenFilesEmpty

    // macOS: open-url events that were received before the app is ready
    const getOpenUrls: string[] = (global as any).getOpenUrls
    if (getOpenUrls && getOpenUrls.length > 0) {
      projectPath = getOpenUrls[0] // We only do one project at a
    }
    // Reset this so we don't accidentally use it again.
    // @ts-ignore
    global['getOpenUrls'] = []

    // Check if we have a project path in the command line arguments
    // If we do, we will load the project at that path
    if (args._.length > 1) {
      if (args._[1].length > 0) {
        projectPath = args._[1]
        // Reset all this value so we don't accidentally use it again.
        args._[1] = ''
      }
    }
  }

  if (projectPath) {
    // We have a project path, load the project information.
    console.log(`Loading project at startup: ${projectPath}`)
    const currentFile = await getCurrentProjectFile(projectPath)

    if (currentFile instanceof Error) {
      console.error(currentFile)
      return null
    }

    console.log(`Project loaded: ${currentFile}`)
    return currentFile
  }

  return null
}

function parseCLIArgs(): minimist.ParsedArgs {
  return minimist(process.argv, {})
}

function registerStartupListeners() {
  /**
   * macOS: when someone drops a file to the not-yet running VSCode, the open-file event fires even before
   * the app-ready event. We listen very early for open-file and remember this upon startup as path to open.
   */
  const macOpenFiles: string[] = []
  // @ts-ignore
  global['macOpenFiles'] = macOpenFiles
  app.on('open-file', function (event, path) {
    event.preventDefault()

    // If we have a mainWindow, lets open another window.
    if (mainWindow) {
      createWindow(path)
    } else {
      macOpenFiles.push(path)
    }
  })

  /**
   * macOS: react to open-url requests.
   */
  const openUrls: string[] = []
  // @ts-ignore
  global['openUrls'] = openUrls
  const onOpenUrl = function (
    event: { preventDefault: () => void },
    url: string
  ) {
    event.preventDefault()

    // If we have a mainWindow, lets open another window.
    if (mainWindow) {
      createWindow(url)
    } else {
      openUrls.push(url)
    }
  }

  app.on('will-finish-launching', function () {
    app.on('open-url', onOpenUrl)
  })
}
