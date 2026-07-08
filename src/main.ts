import os from 'node:os'
import path from 'path'
// Some of the following was taken from bits and pieces of the vite-typescript
// template that ElectronJS provides.
// @ts-ignore: TS1343
import * as packageJSON from '@root/package.json'
import { Bonjour } from 'bonjour-service'
import dotenv from 'dotenv'
import {
  BrowserWindow,
  Menu,
  app,
  autoUpdater,
  dialog,
  ipcMain,
  nativeTheme,
  powerSaveBlocker,
  protocol,
  screen,
  shell,
} from 'electron'
import { autoUpdater as appUpdater } from 'electron-updater'
import {
  Configuration,
  None,
  initiateDeviceAuthorization,
  pollDeviceAuthorizationGrant,
} from 'openid-client'

import fs from 'fs'
import {
  argvFromYargs,
  getPathOrUrlFromArgs,
  parseCLIArgs,
} from '@src/commandLineArgs'
import { initialiseWasmNode } from '@src/lang/wasmUtilsNode'
import { getAppFolderNameFromBuild } from '@src/lib/appFolderName'
import type { AutoUpdateDownloadProgress } from '@src/lib/autoUpdate'
import {
  OAUTH2_DEVICE_CLIENT_ID,
  ZOO_STUDIO_PROTOCOL,
} from '@src/lib/constants'
import { registerFileProtocolCsp } from '@src/lib/csp'
import { DeviceFlowSessionStore } from '@src/lib/deviceFlowSessions'
import { discoverMachineApi } from '@src/lib/discoverMachineApi'
import { getAllowedExternalURL } from '@src/lib/externalUrls'
import getCurrentProjectFile from '@src/lib/getCurrentProjectFile'
import { reportRejection } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { ZookeeperReasoningSleepBlocker } from '@src/lib/zookeeperReasoningSleepBlocker'
import { WindowMenuManager, isAppMenuPage } from '@src/menu/windowMenus'
import {
  type ElectronPluginContext,
  PLUGIN_IPC_SYNC_ACTIVE_PLUGINS_CHANNEL,
  type PluginIpcChannel,
  type PluginIpcHandler,
} from '@src/registry/pluginIpc'
import { configureSystemCertificates } from '@src/systemCertificates'

type ElectronPluginModule = {
  register?: (context: ElectronPluginContext) => void
}

const electronPluginModules: Record<string, ElectronPluginModule> =
  import.meta.glob('./registry/plugins/*/electron.ts', {
    eager: true,
  })

const activeElectronPluginIds = new Set<string>()

function isPluginEnabled(pluginId: string) {
  return activeElectronPluginIds.has(pluginId)
}

function handlePluginInvoke(
  pluginId: string,
  channel: PluginIpcChannel,
  handler: PluginIpcHandler
) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isPluginEnabled(pluginId)) {
      return {
        ok: false,
        error: `The ${pluginId} plugin is disabled.`,
      }
    }

    return handler(event, ...args)
  })
}

function registerElectronPluginModules() {
  for (const pluginModule of Object.values(electronPluginModules)) {
    pluginModule.register?.({
      ipcMain,
      isPluginEnabled,
      handlePluginInvoke,
    })
  }
}

// Linux hack for electron >= 38, here we're forcing XWayland due to issues we've experienced
// https://github.com/electron/electron/issues/41551#issuecomment-3590685943
// Only applied to tests to avoid interfering with users who may be using Wayland
if (
  os.platform() === 'linux' &&
  process.env.NODE_ENV === 'test' &&
  process.env.CI === 'true'
) {
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
  app.commandLine.appendSwitch('ozone-platform', 'x11')
}

// Pull user and system CAs from the OS trust store into Node TLS.
configureSystemCertificates()

let mainWindow: BrowserWindow | null = null
let isInstallingUpdate = false
/** All Electron windows will share this WASM module */
const initPromise = initialiseWasmNode()
const zookeeperReasoningSleepBlocker = new ZookeeperReasoningSleepBlocker(
  powerSaveBlocker
)

type MachineApiSignal = 'on' | 'off'

// Check the command line arguments for a project path
const args = parseCLIArgs(process.argv)
let startupMacOpenFiles: string[] = []
let startupOpenUrls: string[] = []
type DeviceFlowHandle = {
  abort: () => void
  poll: () => Promise<{ access_token?: string }>
}

const deviceFlowSessions = new DeviceFlowSessionStore<
  BrowserWindow,
  DeviceFlowHandle
>()

// @ts-ignore: TS1343
const viteEnv = import.meta.env
const NODE_ENV = process.env.NODE_ENV || viteEnv.MODE

// dotenv override when present
dotenv.config({ path: [`.env.${NODE_ENV}.local`, `.env.${NODE_ENV}`] })

// default vite values based on mode
process.env.NODE_ENV ??= viteEnv.MODE
process.env.VITE_KITTYCAD_WEBSOCKET_URL ??= viteEnv.VITE_KITTYCAD_WEBSOCKET_URL
process.env.VITE_MLEPHANT_WEBSOCKET_URL ??= viteEnv.VITE_MLEPHANT_WEBSOCKET_URL
process.env.VITE_ZOO_BASE_DOMAIN ??= viteEnv.VITE_ZOO_BASE_DOMAIN

// Likely convenient to keep for debugging
console.log('Environment vars', process.env)
console.log('Parsed CLI args', args)

// Set Electron's profile paths before app.ready. Chromium session/cache state is
// initialized lazily, so doing this late lets different builds share app storage.
const appProfilePath = path.join(
  app.getPath('appData'),
  getAppFolderNameFromBuild({
    packageName: packageJSON.name,
    packageVersion: packageJSON.version,
    platform: os.platform(),
  })
)
fs.mkdirSync(appProfilePath, { recursive: true })
app.setPath('userData', appProfilePath)
app.setPath('sessionData', appProfilePath)

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
// electronjs dot org/docs/latest/tutorial/launch-app-from-url-in-another-app#windows-and-linux-code
if (!singleInstanceLock && process.env.NODE_ENV !== 'test') {
  app.quit()
} else {
  registerStartupListeners()
}

const consumeStartupPathOrUrl = (): string | undefined => {
  const pathOrUrl = getPathOrUrlFromArgs(args)
  if (pathOrUrl?.startsWith(ZOO_STUDIO_PROTOCOL + '://')) {
    console.log('Retrieved deep link from CLI args', pathOrUrl)
    return pathOrUrl
  }

  // macOS: open-url events that were received before the app is ready.
  if (startupOpenUrls[0]) {
    const openUrl = startupOpenUrls[0]
    startupOpenUrls = []
    console.log('Retrieved deep link from open-url', openUrl)
    return openUrl
  }

  // The dev and test launchers pass "." as an arg. Do not turn that into a
  // startup project route.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL || process.env.NODE_ENV === 'test') {
    return undefined
  }

  // macOS: open-file events that were received before the app is ready.
  if (startupMacOpenFiles[0]) {
    const filePath = startupMacOpenFiles[0]
    startupMacOpenFiles = []
    return filePath
  }

  if (pathOrUrl) {
    args._[1] = ''
    return pathOrUrl
  }

  return undefined
}

const createWindow = (pathToOpen?: string): BrowserWindow => {
  let newWindow: BrowserWindow | null = null

  if (!newWindow) {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.workAreaSize

    // Use 90% vertical screen space, 16:9 aspect ratio for the width,
    // but ensure it fits within the screen width with a bit of padding
    let windowHeight = Math.round(height * 0.9)
    let windowWidth = Math.min(Math.round(windowHeight * (16 / 9)), width - 50)

    let x = primaryDisplay.workArea.x + Math.floor((width - windowWidth) / 2)
    let y = primaryDisplay.workArea.y + Math.floor((height - windowHeight) / 2)

    // If size was saved already, use it
    const localDeviceState = loadLocalDeviceState()
    const windowBounds = localDeviceState?.windowBounds
    if (windowBounds) {
      // Only use bounds if the window is still visible on any of the displays
      // (one screen could have been disconnected since config was saved).
      if (isBoundsVisible(windowBounds)) {
        windowWidth = windowBounds.width
        windowHeight = windowBounds.height
        x = windowBounds.x
        y = windowBounds.y
      }
    }

    newWindow = new BrowserWindow({
      autoHideMenuBar: false,
      show: false,
      enableLargerThanScreen: true,
      width: windowWidth,
      height: windowHeight,
      x,
      y,
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
    // This is only needed on windows, but it doesn't do any harm on other platforms.
    // On windows the initial width, height supplied above cannot be larger than screen resolution which causes
    // some weird border to appear when the last window size was close to full screen.
    newWindow.setBounds({ x, y, width: windowWidth, height: windowHeight })
  }

  const webContentsId = newWindow.webContents.id

  newWindow.webContents.on('render-process-gone', () => {
    zookeeperReasoningSleepBlocker.clear(webContentsId)
  })

  newWindow.on('close', () => {
    const bounds = newWindow.getBounds()
    saveLocalDeviceState({
      version: '0.1', // Version of the config file, so we add migrations if we break it later
      windowBounds: bounds,
    })
  })
  newWindow.on('closed', () => {
    // BrowserWindow-scoped resources must die with that exact window.
    windowMenuManager.clearWindow(newWindow)
    deviceFlowSessions.abort(newWindow)
    zookeeperReasoningSleepBlocker.clear(webContentsId)
    if (mainWindow !== newWindow) return
    const nextMainWindow = BrowserWindow.getAllWindows().find(
      (browserWindow) => !browserWindow.isDestroyed()
    )
    mainWindow = nextMainWindow ?? null
  })
  newWindow.on('focus', () => {
    windowMenuManager.rebuildWindowMenu(newWindow)
  })

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
      // otherwise we're trying to resolve a local file/project path
      resolveProjectPathForWindow(initPromise, pathToOpen)
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
  // newWindow.webContents.openDevTools()

  // Disable refresh shortcut globally for the desktop application
  newWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
      event.preventDefault()
    }
  })

  newWindow.on('ready-to-show', () => {
    if (!process.env.HEADLESS) newWindow.show()
  })

  return newWindow
}

const menuActions = {
  openNewWindow: () => {
    createWindow()
  },
}
const windowMenuManager = new WindowMenuManager(menuActions)

function sendToAllWindows(channel: string, ...args: unknown[]) {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (browserWindow.isDestroyed()) continue
    browserWindow.webContents.send(channel, ...args)
  }
}

interface LocalDeviceState {
  windowBounds: Electron.Rectangle
  version: string // "0.1"
}

const userDataPath = app.getPath('userData')
const localDeviceStatePath = path.join(userDataPath, 'device_state.json')

const loadLocalDeviceState = (): LocalDeviceState | null => {
  try {
    const data = fs.readFileSync(localDeviceStatePath, 'utf8')
    const localDeviceState = JSON.parse(data) as LocalDeviceState
    if (localDeviceState.windowBounds) {
      return localDeviceState
    }
  } catch (e) {
    console.log("Can't load device_state.json", e)
  }
  return null
}

const saveLocalDeviceState = (state: LocalDeviceState) => {
  fs.writeFileSync(localDeviceStatePath, JSON.stringify(state), {
    encoding: 'utf8',
  })
}

const isBoundsVisible = (bounds: Electron.Rectangle): boolean => {
  const headerArea = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: 40,
  }
  return screen.getAllDisplays().some((display) => {
    const displayBounds = display.bounds
    const visibleHeaderArea = intersectRect(headerArea, displayBounds)
    if (visibleHeaderArea) {
      // We want the header's height to be fully visible, and the header to be at least 50% visible on its width
      // (might be ok that some part of it is cut off)
      if (
        visibleHeaderArea.height >= headerArea.height &&
        visibleHeaderArea.width >= headerArea.width / 2
      ) {
        return true
      }
    }
    return false
  })
}

// Quit when all windows are closed, even on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q, but it is a really weird behavior with our app.
app.on('window-all-closed', () => {
  if (isInstallingUpdate) {
    return
  }

  app.quit()
})

// Required for registerFileProtocolCsp file:// intercepting
// This fixes media file streaming
// see https://github.com/electron/electron/issues/40447
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'file',
    privileges: {
      stream: true,
    },
  },
])

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', (event, data) => {
  // Avoid potentially 2 ready fires
  if (mainWindow) return

  registerFileProtocolCsp()

  // Create the mainWindow
  mainWindow = createWindow(consumeStartupPathOrUrl())
  // Set menu application to null to avoid default electron menu
  Menu.setApplicationMenu(null)
})

// For now there is no good reason to separate these out to another file(s)
// There is just not enough code to warrant it and further abstracts everything
// which is already quite abstracted

const appTestProperties: Record<string, unknown> = {}
Reflect.set(app, 'testProperty', appTestProperties)
if (NODE_ENV === 'test') {
  appTestProperties.nativeMenu = {
    clickMenuItemForWindow: (browserWindowId: number, menuId: string) => {
      const targetWindow = BrowserWindow.fromId(browserWindowId)
      if (!targetWindow) {
        return false
      }

      return windowMenuManager.clickMenuItemForWindow(targetWindow, menuId)
    },
    getMenuItemForWindow: (browserWindowId: number, menuId: string) => {
      const targetWindow = BrowserWindow.fromId(browserWindowId)
      if (!targetWindow) {
        return null
      }

      return windowMenuManager.getMenuItemSnapshotForWindow(
        targetWindow,
        menuId
      )
    },
  }
  Reflect.set(app, 'resizeWindow', (width: number, height: number) => {
    const targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow
    return targetWindow?.setSize(width, height)
  })
}
// @ts-ignore can't declaration merge with App
app.machineApiState = 'off' as MachineApiSignal

const getMachineApiState = (): MachineApiSignal =>
  // @ts-ignore can't declaration merge with App
  app.machineApiState

const setMachineApiState = (signal: MachineApiSignal) => {
  // @ts-ignore can't declaration merge with App
  app.machineApiState = signal
}

ipcMain.handle('app.testProperty', (_event, propertyName: string) => {
  return appTestProperties[propertyName]
})

ipcMain.handle('machine-api.get-state', () => {
  return getMachineApiState() === 'on'
})

ipcMain.handle('machine-api.set-state', (_event, signal: MachineApiSignal) => {
  setMachineApiState(signal)
  return getMachineApiState() === 'on'
})

ipcMain.handle(
  'app.setZookeeperReasoningSleepBlocked',
  (event, active: boolean) => {
    return zookeeperReasoningSleepBlocker.setActive(event.sender.id, active)
  }
)

ipcMain.handle('app.resizeWindow', (event, data) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  return targetWindow?.setSize(data[0], data[1])
})

ipcMain.handle('app.getPath', (event, data) => {
  return app.getPath(data)
})

ipcMain.handle(
  PLUGIN_IPC_SYNC_ACTIVE_PLUGINS_CHANNEL,
  (_event, pluginIds: unknown) => {
    if (!isArray(pluginIds)) {
      return
    }
    if (
      !pluginIds.every(
        (pluginId): pluginId is string => typeof pluginId === 'string'
      )
    ) {
      return
    }

    activeElectronPluginIds.clear()
    for (const pluginId of pluginIds) {
      activeElectronPluginIds.add(pluginId)
    }
  }
)

registerElectronPluginModules()

ipcMain.handle('dialog.showOpenDialog', (event, data) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (targetWindow && !targetWindow.isDestroyed()) {
    return dialog.showOpenDialog(targetWindow, data)
  }

  return dialog.showOpenDialog(data)
})
ipcMain.handle('dialog.showSaveDialog', (event, data) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (targetWindow && !targetWindow.isDestroyed()) {
    return dialog.showSaveDialog(targetWindow, data)
  }

  return dialog.showSaveDialog(data)
})

ipcMain.handle('shell.showItemInFolder', (event, data) => {
  return shell.showItemInFolder(data)
})

ipcMain.handle('shell.openExternal', (_event, data) => {
  const allowedURL = getAllowedExternalURL(data)
  if (allowedURL instanceof Error) {
    return Promise.reject(allowedURL)
  }

  return shell.openExternal(allowedURL)
})

ipcMain.handle('openInNewWindow', (event, data) => {
  return createWindow(data)
})

ipcMain.handle('argv.parser', (event, data) => {
  return argvFromYargs
})

ipcMain.handle('startDeviceFlow', async (event, host: string) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (!targetWindow) {
    return Promise.reject(new Error('No window available for device flow'))
  }

  const config = new Configuration(
    {
      issuer: host,
      device_authorization_endpoint: `${host}/oauth2/device/auth`,
      token_endpoint: `${host}/oauth2/device/token`,
    },
    OAUTH2_DEVICE_CLIENT_ID,
    undefined,
    None()
  )
  const deviceAuthorizationResponse = await initiateDeviceAuthorization(
    config,
    {}
  )
  const verificationUri =
    deviceAuthorizationResponse.verification_uri_complete ??
    deviceAuthorizationResponse.verification_uri

  if (!verificationUri) {
    return Promise.reject(new Error('No verification URI received'))
  }

  const abortController = new AbortController()
  const handle: DeviceFlowHandle = {
    abort: () => abortController.abort(),
    poll: () =>
      pollDeviceAuthorizationGrant(
        config,
        deviceAuthorizationResponse,
        {},
        {
          signal: abortController.signal,
        }
      ),
  }

  deviceFlowSessions.set(targetWindow, {
    handle,
    verificationUri,
  })

  return {
    userCode: deviceAuthorizationResponse.user_code,
    verificationUri,
  }
})

ipcMain.handle('cancelDeviceFlow', (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (targetWindow) {
    deviceFlowSessions.abort(targetWindow)
  }
})

ipcMain.handle('loginWithDeviceFlow', async (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  const deviceFlowSession = targetWindow
    ? deviceFlowSessions.get(targetWindow)
    : undefined
  if (!targetWindow || !deviceFlowSession) {
    return Promise.reject(
      new Error(
        'No handle available. Did you call startDeviceFlow before calling this?'
      )
    )
  }

  if (NODE_ENV !== 'test') {
    const verificationUri = getAllowedExternalURL(
      deviceFlowSession.verificationUri
    )
    if (verificationUri instanceof Error) {
      return Promise.reject(verificationUri)
    }

    shell.openExternal(verificationUri).catch(reportRejection)
  }

  // Wait for the user to login.
  try {
    console.log('Polling for token')
    const tokenSet = await deviceFlowSession.handle.poll()
    console.log('Received token set')
    console.log(tokenSet)
    return tokenSet.access_token
  } catch (e) {
    console.log(e)
  } finally {
    deviceFlowSessions.deleteIfCurrent(targetWindow, deviceFlowSession)
  }

  return Promise.reject(new Error('No access token received'))
})

// Used to find other devices on the local network, e.g. 3D printers, CNC machines, etc.
ipcMain.handle('find_machine_api', () => {
  if (getMachineApiState() !== 'on') {
    return null
  }

  return discoverMachineApi({
    createBonjour: (onError) => new Bonjour({}, onError),
    onError: (error) => {
      console.log('An issue with Bonjour services was encountered!')
      console.error(error)
    },
  })
})

// Given the route create the new context menu
// internal menu state will be reset since it creates a new one from
// the initial state
ipcMain.handle('create-menu', (event, data) => {
  const page = data.page

  if (!isAppMenuPage(page)) {
    return
  }

  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (!targetWindow) {
    return
  }

  windowMenuManager.setWindowMenuPage(targetWindow, page)
})

ipcMain.handle('enable-menu', (event, data) => {
  const menuId = data.menuId
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (targetWindow) {
    windowMenuManager.updateMenuStateForWindow(targetWindow, menuId, true)
  }
})

ipcMain.handle('disable-menu', (event, data) => {
  const menuId = data.menuId
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (targetWindow) {
    windowMenuManager.updateMenuStateForWindow(targetWindow, menuId, false)
  }
})

ipcMain.handle('get-path-userdata', () => app.getPath('userData'))

app.on('ready', () => {
  // Disable auto updater on non-versioned builds
  if (packageJSON.version === '0.0.0' && viteEnv.MODE !== 'production') {
    return
  }

  // TODO: check if we can enable this someday https://github.com/KittyCAD/modeling-app/issues/4120
  appUpdater.disableDifferentialDownload = true
  // Needed for the rollback process at .github/ISSUE_TEMPLATE/release.md
  appUpdater.allowDowngrade = true

  // Check for updates in the background at startup and then every 15 minutes
  let backgroundCheckingForUpdates = false
  const checkForUpdatesBackground = () => {
    backgroundCheckingForUpdates = true
    appUpdater
      .checkForUpdates()
      .catch(reportRejection)
      .finally(() => {
        backgroundCheckingForUpdates = false
      })
  }
  const oneSecond = 1000
  const fifteenMinutes = 15 * 60 * 1000
  setTimeout(checkForUpdatesBackground, oneSecond)
  setInterval(checkForUpdatesBackground, fifteenMinutes)

  appUpdater.on('checking-for-update', () => {
    console.log('checking-for-update')
    if (!backgroundCheckingForUpdates) {
      sendToAllWindows('update-checking')
    }
  })

  appUpdater.on('update-not-available', (info) => {
    console.log('update-not-available', info)
    if (!backgroundCheckingForUpdates) {
      sendToAllWindows('update-not-available')
    }
  })

  appUpdater.on('error', (error) => {
    console.error('update-error', error)
    sendToAllWindows('update-error', error)
  })

  appUpdater.on('update-available', (info) => {
    console.log('update-available', info)
  })

  appUpdater.prependOnceListener(
    'download-progress',
    (progress: AutoUpdateDownloadProgress) => {
      console.log('update-download-start', progress)
      sendToAllWindows('update-download-start', progress)
    }
  )

  appUpdater.on('download-progress', (progress: AutoUpdateDownloadProgress) => {
    console.log('download-progress', progress)
    sendToAllWindows('update-download-progress', progress)
  })

  appUpdater.on('update-downloaded', (info) => {
    console.log('update-downloaded', info)
    sendToAllWindows('update-downloaded', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    })
  })

  // Based on https://github.com/electron-userland/electron-builder/issues/8997#issuecomment-2846114257
  const prepareMacUpdateInstall = () => {
    const beforeQuitListeners = app.listeners('before-quit')
    app.removeAllListeners('before-quit')
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.removeAllListeners('close')
    }

    autoUpdater.once('before-quit-for-update', () => {
      // Do any before-quit cleanup here
      for (const listener of beforeQuitListeners) {
        try {
          listener.call(app, {
            preventDefault: () => {
              // `preventDefault` during update install causes quit+install to hang.
            },
          })
        } catch (error) {
          console.error(
            'Failed to run before-quit listener during update install',
            error
          )
        }
      }

      // Force app to exit
      app.exit()
    })
  }

  ipcMain.handle('app.restart', () => {
    if (isInstallingUpdate) {
      return
    }

    isInstallingUpdate = true
    if (process.platform === 'darwin') {
      prepareMacUpdateInstall()
    }

    try {
      appUpdater.quitAndInstall()
    } catch (error) {
      isInstallingUpdate = false
      return Promise.reject(error)
    }
  })

  ipcMain.handle('app.checkForUpdates', () => {
    return appUpdater.checkForUpdates()
  })
})

const resolveProjectPathForWindow = async (
  initPromise: Promise<ModuleType>,
  pathToOpen?: string
): Promise<string | null> => {
  // Make sure we have WASM, because we're about to use it indirectly.
  const wasmInstance = await initPromise
  // If we are in development mode, we don't want to load a project at
  // startup.
  // Since the args passed are always '.'
  // aka Forge for npm run tron:start live dev or playwright tests, but not dev packaged apps
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL || process.env.NODE_ENV === 'test') {
    return null
  }

  const projectPath: string | null = pathToOpen || null

  if (projectPath) {
    // We have a project path, load the project information.
    console.log(`Loading project at startup: ${projectPath}`)
    const currentFile = await getCurrentProjectFile(projectPath, wasmInstance)

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
  // Linux and Windows from electronjs dot org/docs/latest/tutorial/launch-app-from-url-in-another-app
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
  startupMacOpenFiles = []
  app.on('open-file', function (event, path) {
    event.preventDefault()

    // If we have a mainWindow, lets open another window.
    if (mainWindow) {
      createWindow(path)
    } else {
      startupMacOpenFiles.push(path)
    }
  })

  /**
   * macOS: react to open-url requests (including Deep Link on second instances)
   */
  startupOpenUrls = []
  const onOpenUrl = function (
    event: { preventDefault: () => void },
    url: string
  ) {
    event.preventDefault()

    // If we have a mainWindow, lets open another window.
    if (mainWindow) {
      createWindow(url)
    } else {
      startupOpenUrls.push(url)
    }
  }

  app.on('will-finish-launching', function () {
    app.on('open-url', onOpenUrl)
  })
}

function intersectRect(
  a: Electron.Rectangle,
  b: Electron.Rectangle
): Electron.Rectangle | null {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)

  const width = x2 - x1
  const height = y2 - y1

  if (width <= 0 || height <= 0) {
    return null
  }

  return { x: x1, y: y1, width, height }
}
