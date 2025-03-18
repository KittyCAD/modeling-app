// Some of the following was taken from bits and pieces of the vite-typescript
// template that ElectronJS provides.
import dotenv from 'dotenv'
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeTheme,
  desktopCapturer,
  systemPreferences,
} from 'electron'
import path from 'path'
import { Issuer } from 'openid-client'
import { Bonjour, Service } from 'bonjour-service'
// @ts-ignore: TS1343
import * as kittycad from '@kittycad/lib/import'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import getCurrentProjectFile from 'lib/getCurrentProjectFile'
import os from 'node:os'
import { reportRejection } from 'lib/trap'
import { ZOO_STUDIO_PROTOCOL } from 'lib/constants'
import {
  argvFromYargs,
  getPathOrUrlFromArgs,
  parseCLIArgs,
} from './commandLineArgs'

import * as packageJSON from '../package.json'

let mainWindow: BrowserWindow | null = null

// Check the command line arguments for a project path
const args = parseCLIArgs(process.argv)

// @ts-ignore: TS1343
const viteEnv = import.meta.env
const NODE_ENV = process.env.NODE_ENV || viteEnv.MODE
const IS_PLAYWRIGHT = process.env.IS_PLAYWRIGHT

// dotenv override when present
dotenv.config({ path: [`.env.${NODE_ENV}.local`, `.env.${NODE_ENV}`] })

// default vite values based on mode
process.env.NODE_ENV ??= viteEnv.MODE
process.env.BASE_URL ??= viteEnv.VITE_KC_API_BASE_URL
process.env.VITE_KC_API_WS_MODELING_URL ??= viteEnv.VITE_KC_API_WS_MODELING_URL
process.env.VITE_KC_API_BASE_URL ??= viteEnv.VITE_KC_API_BASE_URL
process.env.VITE_KC_SITE_BASE_URL ??= viteEnv.VITE_KC_SITE_BASE_URL
process.env.VITE_KC_SITE_APP_URL ??= viteEnv.VITE_KC_SITE_APP_URL
process.env.VITE_KC_SKIP_AUTH ??= viteEnv.VITE_KC_SKIP_AUTH
process.env.VITE_KC_CONNECTION_TIMEOUT_MS ??=
  viteEnv.VITE_KC_CONNECTION_TIMEOUT_MS

// Likely convenient to keep for debugging
console.log('Environment vars', process.env)
console.log('Parsed CLI args', args)

/// Register our application to handle all "zoo-studio:" protocols.
const singleInstanceLock = app.requestSingleInstanceLock()
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
// Checking against this lock is needed for Windows and Linux, see
// https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app#windows-and-linux-code
if (!singleInstanceLock && !IS_PLAYWRIGHT) {
  app.quit()
} else {
  registerStartupListeners()
}

const createWindow = (pathToOpen?: string, reuse?: boolean): BrowserWindow => {
  let newWindow

  if (reuse) {
    newWindow = mainWindow
  }
  if (!newWindow) {
    newWindow = new BrowserWindow({
      autoHideMenuBar: false,
      show: false,
      enableLargerThanScreen: true,
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
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1C1C1C' : '#FCFCFC',
    })
  }

  // Deep Link: Case of a cold start from Windows or Linux
  const pathOrUrl = getPathOrUrlFromArgs(args)
  if (
    !pathToOpen &&
    pathOrUrl &&
    pathOrUrl.startsWith(ZOO_STUDIO_PROTOCOL + '://')
  ) {
    pathToOpen = pathOrUrl
    console.log('Retrieved deep link from CLI args', pathToOpen)
  }

  // Deep Link: Case of a second window opened for macOS
  // @ts-ignore
  if (!pathToOpen && global['openUrls'] && global['openUrls'][0]) {
    // @ts-ignore
    pathToOpen = global['openUrls'][0]
    console.log('Retrieved deep link from open-url', pathToOpen)
  }

  const pathIsCustomProtocolLink =
    pathToOpen?.startsWith(ZOO_STUDIO_PROTOCOL) ?? false

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const filteredPath = pathToOpen
      ? decodeURI(pathToOpen.replace(ZOO_STUDIO_PROTOCOL + '://', ''))
      : ''
    const fullHashBasedUrl = `${MAIN_WINDOW_VITE_DEV_SERVER_URL}/#/${filteredPath}`
    newWindow.loadURL(fullHashBasedUrl).catch(reportRejection)
  } else {
    if (pathIsCustomProtocolLink && pathToOpen) {
      // We're trying to open a custom protocol link
      // TODO: fix the replace %3 thing
      const urlNoProtocol = pathToOpen
        .replace(ZOO_STUDIO_PROTOCOL + '://', '')
        .replaceAll('%3D', '')
        .replaceAll('%3', '')
      const filteredPath = decodeURI(urlNoProtocol)
      const startIndex = path.join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`
      )
      newWindow
        .loadFile(startIndex, {
          hash: filteredPath,
        })
        .catch(reportRejection)
    } else {
      // otherwise we're trying to open a local file from the command line
      getProjectPathAtStartup(pathToOpen)
        .then(async (projectPath) => {
          const startIndex = path.join(
            __dirname,
            `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`
          )

          if (projectPath === null) {
            await newWindow.loadFile(startIndex)
            return
          }

          const fullUrl = `/file/${encodeURIComponent(projectPath)}`
          console.log('Full URL', fullUrl)

          await newWindow.loadFile(startIndex, {
            hash: fullUrl,
          })
        })
        .catch(reportRejection)
    }
  }

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()

  if (!reuse) {
    if (!process.env.HEADLESS) newWindow.show()
  }

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
  // Avoid potentially 2 ready fires
  if (mainWindow) return
  // Create the mainWindow
  mainWindow = createWindow()
})

// For now there is no good reason to separate these out to another file(s)
// There is just not enough code to warrant it and further abstracts everything
// which is already quite abstracted

// @ts-ignore
// electron/electron.d.ts has done type = App, making declaration merging not
// possible :(
app.resizeWindow = async (width: number, height: number) => {
  return mainWindow?.setSize(width, height)
}

// @ts-ignore can't declaration merge with App
app.testProperty = {}

ipcMain.handle('app.testProperty', (event, propertyName) => {
  // @ts-ignore can't declaration merge with App
  return app.testProperty[propertyName]
})

ipcMain.handle('app.resizeWindow', (event, data) => {
  return mainWindow?.setSize(data[0], data[1])
})

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

ipcMain.handle(
  'take.screenshot',
  async (event, data: { width: number; height: number }) => {
    /**
     * Operation system access to getting screen sources, even though we are only use application windows
     * Linux: Yes!
     * Mac OS: This user consent was not required on macOS 10.13 High Sierra so this method will always return granted. macOS 10.14 Mojave or higher requires consent for microphone and camera access. macOS 10.15 Catalina or higher requires consent for screen access.
     * Windows 10: has a global setting controlling microphone and camera access for all win32 applications. It will always return granted for screen and for all media types on older versions of Windows.
     */
    let accessToScreenSources = true

    // Can we check for access and if so, is it granted
    // Linux does not even have access to the function getMediaAccessStatus, not going to polyfill
    if (systemPreferences && systemPreferences.getMediaAccessStatus) {
      const accessString = systemPreferences.getMediaAccessStatus('screen')
      accessToScreenSources = accessString === 'granted' ? true : false
    }

    if (accessToScreenSources) {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: data.width, height: data.height },
      })

      for (const source of sources) {
        // electron-builder uses the value of productName in package.json for the title of the application
        if (source.name === packageJSON.productName) {
          // @ts-ignore image/png is real.
          return source.thumbnail.toDataURL('image/png') // The image to display the screenshot
        }
      }
    }

    // Cannot take a native desktop screenshot, unable to access screens
    return ''
  }
)

ipcMain.handle('argv.parser', (event, data) => {
  return argvFromYargs
})

ipcMain.handle('startDeviceFlow', async (_, host: string) => {
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

  // Register this handle to be used later.
  ipcMain.handleOnce('loginWithDeviceFlow', async () => {
    if (!handle) {
      return Promise.reject(
        new Error(
          'No handle available. Did you call startDeviceFlow before calling this?'
        )
      )
    }
    shell.openExternal(handle.verification_uri_complete).catch(reportRejection)

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

  // Return the user code so the app can display it.
  return handle.user_code
})

ipcMain.handle('kittycad', (event, data) => {
  return data.access
    .split('.')
    .reduce(
      (obj: any, prop: any) => obj[prop],
      kittycad
    )(data.args)
})

// Used to find other devices on the local network, e.g. 3D printers, CNC machines, etc.
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
        console.log(`Machine API found at ${ip}:${port}`)
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

app.on('ready', () => {
  // Disable auto updater on non-versioned builds
  if (packageJSON.version === '0.0.0' && viteEnv.MODE !== 'production') {
    return
  }

  const autoUpdater = getAutoUpdater()
  // TODO: we're getting `Error: Response ends without calling any handlers` with our setup,
  // so at the moment this isn't worth enabling
  autoUpdater.disableDifferentialDownload = true
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(reportRejection)
  }, 1000)
  const fifteenMinutes = 15 * 60 * 1000
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(reportRejection)
  }, fifteenMinutes)

  autoUpdater.on('error', (error) => {
    console.error('update-error', error)
    mainWindow?.webContents.send('update-error', error)
  })

  autoUpdater.on('update-available', (info) => {
    console.log('update-available', info)
  })

  autoUpdater.prependOnceListener('download-progress', (progress) => {
    // For now, we'll send nothing and just start a loading spinner.
    // See below for a TODO to send progress data to the renderer.
    console.log('update-download-start', {
      version: '',
    })
    mainWindow?.webContents.send('update-download-start', progress)
  })

  autoUpdater.on('download-progress', (progress) => {
    // TODO: in a future PR (https://github.com/KittyCAD/modeling-app/issues/3994)
    // send this data to mainWindow to show a progress bar for the download.
    console.log('download-progress', progress)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('update-downloaded', info)
    mainWindow?.webContents.send('update-downloaded', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    })
  })

  ipcMain.handle('app.restart', () => {
    autoUpdater.quitAndInstall()
  })
  ipcMain.handle('app.checkForUpdates', () => {
    return autoUpdater.checkForUpdates()
  })
})

const getProjectPathAtStartup = async (
  filePath?: string
): Promise<string | null> => {
  // If we are in development mode, we don't want to load a project at
  // startup.
  // Since the args passed are always '.'
  // aka Forge for yarn tron:start live dev or playwright tests, but not dev packaged apps
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL || IS_PLAYWRIGHT) {
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

function registerStartupListeners() {
  // Linux and Windows from https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Deep Link: second instance for Windows and Linux
    // Likely convenient to keep for debugging
    console.log(
      'Parsed CLI args from second instance',
      parseCLIArgs(commandLine)
    )
    const pathOrUrl = getPathOrUrlFromArgs(parseCLIArgs(commandLine))
    console.log('Retrieved path or deep link from second-instance', pathOrUrl)
    createWindow(pathOrUrl)
  })

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
   * macOS: react to open-url requests (including Deep Link on second instances)
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
