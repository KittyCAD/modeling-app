/**
 * Electron main process.
 *
 * Deliberately small. It owns the window, the security policy, and privileged
 * filesystem access — nothing else. Application behaviour lives in the
 * renderer, where the registry can compose it; anything that leaks in here
 * becomes a capability no feature can see or replace.
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import {
  Configuration,
  initiateDeviceAuthorization,
  None,
  pollDeviceAuthorizationGrant,
} from 'openid-client'
import {
  channels,
  type DeviceAuthorization,
  type DirectoryEntry,
} from './channels'

// Injected by @electron-forge/plugin-vite.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

const isDevelopment = Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL)

/**
 * Content Security Policy for the packaged app.
 *
 * When packaged, the renderer is served over `file://`, which cannot carry HTTP
 * headers, so the policy is attached to responses here instead.
 * `wasm-unsafe-eval` is required: KCL is compiled to WebAssembly.
 */
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  // Profile images come from whichever identity provider the account uses —
  // Google, GitHub, Zoo's own storage — so `self` is not enough. Restricted to
  // https so a downgraded request cannot be substituted.
  "img-src 'self' https: blob: data:",
  "connect-src 'self' https://api.zoo.dev wss://api.zoo.dev https://api.dev.zoo.dev wss://api.dev.zoo.dev",
  "object-src 'none'",
  "frame-src 'none'",
].join('; ')

// ---------------------------------------------------------------------------
// Granted roots
// ---------------------------------------------------------------------------

/**
 * Directories the renderer is allowed to touch.
 *
 * Seeded with the default projects directory. Anything else gets in only by the
 * user picking it in an OS dialog, which is what makes "a library can live
 * anywhere on disk" safe: reach is granted by explicit consent, not asserted by
 * the renderer. Persisted so a configured library still resolves after a
 * restart.
 */
let grantedRoots: string[] = []

function grantsFile(): string {
  return path.join(app.getPath('userData'), 'granted-roots.json')
}

function defaultProjectsDirectory(): string {
  return path.join(app.getPath('documents'), 'Zoo Design Studio')
}

async function loadGrantedRoots(): Promise<void> {
  const fallback = defaultProjectsDirectory()
  await fs.mkdir(fallback, { recursive: true })

  let stored: string[] = []
  try {
    const raw = await fs.readFile(grantsFile(), 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      stored = parsed.filter(
        (entry): entry is string => typeof entry === 'string'
      )
    }
  } catch {
    // No grants yet, or the file is unreadable. The default root is enough to
    // start; a lost grant costs the user one dialog, not their data.
  }

  grantedRoots = Array.from(new Set([fallback, ...stored]))
}

async function saveGrantedRoots(): Promise<void> {
  try {
    await fs.writeFile(
      grantsFile(),
      JSON.stringify(grantedRoots, null, 2),
      'utf8'
    )
  } catch (error) {
    console.error('Could not persist granted roots', error)
  }
}

async function grantRoot(directory: string): Promise<void> {
  if (grantedRoots.includes(directory)) return
  grantedRoots = [...grantedRoots, directory]
  await saveGrantedRoots()
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}

/**
 * Where user-level settings live.
 *
 * `userData` is the per-environment configuration directory Electron gives us,
 * so a dev build and a packaged build do not share a settings file — which is
 * what you want the first time a dev build writes something malformed.
 */
function userSettingsPath(): string {
  return path.join(app.getPath('userData'), 'user.toml')
}

/**
 * Confine a renderer-supplied path to one of the granted roots.
 *
 * Checks the resolved path, so a file that does not exist yet is still
 * validated, and then what it really points at, so a symlink cannot lead out of
 * every granted tree. The renderer is the least trusted part of a desktop app
 * and will eventually run third-party plugin code.
 */
async function resolveGranted(requested: string): Promise<string> {
  if (grantedRoots.length === 0) await loadGrantedRoots()

  const resolved = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(grantedRoots[0], requested)

  const realRoots = await Promise.all(
    grantedRoots.map((root) => fs.realpath(root).catch(() => root))
  )

  if (!realRoots.some((root) => isInside(root, resolved))) {
    throw new Error(`Path is outside every granted directory: ${requested}`)
  }

  try {
    const real = await fs.realpath(resolved)
    if (!realRoots.some((root) => isInside(root, real))) {
      throw new Error(
        `Path resolves outside every granted directory: ${requested}`
      )
    }
    return real
  } catch (error) {
    // ENOENT is expected when writing a new file; anything else is real.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return resolved
  }
}

// ---------------------------------------------------------------------------
// OAuth2 device flow
// ---------------------------------------------------------------------------

/**
 * The device-flow client id.
 *
 * Public by design: a device-flow client cannot keep a secret, which is the
 * whole reason the flow exists.
 */
const DEVICE_CLIENT_ID = '2af127fb-e14e-400a-9c57-a9ed08d1a5b7'

interface DeviceFlowSession {
  abort: () => void
  poll: () => Promise<{ access_token?: string }>
  verificationUri: string
}

/**
 * Device flows in progress, one per window.
 *
 * Scoped to the window because that is what the user is looking at: closing it
 * must abort its polling rather than leave a request running against the
 * identity provider forever.
 */
const deviceFlows = new Map<number, DeviceFlowSession>()

function abortDeviceFlow(windowId: number) {
  deviceFlows.get(windowId)?.abort()
  deviceFlows.delete(windowId)
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpcHandlers() {
  ipcMain.handle(channels.projectsDirectory, async () => {
    if (grantedRoots.length === 0) await loadGrantedRoots()
    return grantedRoots[0]
  })

  ipcMain.handle(channels.grantedRoots, async () => {
    if (grantedRoots.length === 0) await loadGrantedRoots()
    return [...grantedRoots]
  })

  ipcMain.handle(
    channels.chooseDirectory,
    async (_event, options: { title?: string; defaultPath?: string } = {}) => {
      if (grantedRoots.length === 0) await loadGrantedRoots()
      const result = await dialog.showOpenDialog({
        title: options.title ?? 'Choose a folder',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: options.defaultPath ?? grantedRoots[0],
      })
      if (result.canceled || result.filePaths.length === 0) return null

      // Picking a directory is the grant.
      const chosen = result.filePaths[0]
      await grantRoot(chosen)
      return chosen
    }
  )

  ipcMain.handle(channels.stat, async (_event, target: string) => {
    const stats = await fs.stat(await resolveGranted(target))
    return {
      kind: stats.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      modifiedAt: stats.mtimeMs,
    }
  })

  ipcMain.handle(channels.readFile, async (_event, target: string) => {
    const file = await resolveGranted(target)
    // A plain array, not a Buffer: Buffers arrive over IPC as serialised
    // objects, and the renderer wants bytes it can hand to a Uint8Array.
    return Array.from(await fs.readFile(file))
  })

  ipcMain.handle(channels.readTextFile, async (_event, target: string) =>
    fs.readFile(await resolveGranted(target), 'utf8')
  )

  ipcMain.handle(
    channels.writeTextFile,
    async (_event, target: string, contents: string) => {
      const file = await resolveGranted(target)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, contents, 'utf8')
    }
  )

  ipcMain.handle(channels.exists, async (_event, target: string) => {
    try {
      await fs.stat(await resolveGranted(target))
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(
    channels.readDirectory,
    async (_event, target: string): Promise<DirectoryEntry[]> => {
      const directory = await resolveGranted(target)
      const entries = await fs.readdir(directory, { withFileTypes: true })
      return entries
        .filter((entry) => !entry.name.startsWith('.'))
        .map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory() ? 'directory' : 'file',
        }))
    }
  )

  ipcMain.handle(
    channels.listFilesRecursive,
    async (_event, target: string): Promise<string[]> => {
      const root = await resolveGranted(target)

      const walk = async (directory: string): Promise<string[]> => {
        const entries = await fs.readdir(directory, { withFileTypes: true })
        const nested = await Promise.all(
          entries
            .filter((entry) => !entry.name.startsWith('.'))
            .map(async (entry) => {
              const child = path.join(directory, entry.name)
              return entry.isDirectory()
                ? walk(child)
                : [path.relative(root, child)]
            })
        )
        return nested.flat()
      }

      return walk(root)
    }
  )

  ipcMain.handle(channels.makeDirectory, async (_event, target: string) => {
    await fs.mkdir(await resolveGranted(target), { recursive: true })
  })

  ipcMain.handle(channels.remove, async (_event, target: string) => {
    // Trash rather than unlink: losing a project to a misrouted delete is not
    // something the person who did it can undo.
    await shell.trashItem(await resolveGranted(target))
  })

  ipcMain.handle(channels.rename, async (_event, from: string, to: string) => {
    await fs.rename(await resolveGranted(from), await resolveGranted(to))
  })

  ipcMain.handle(channels.userSettingsPath, () => userSettingsPath())

  ipcMain.handle(channels.readUserSettings, async () => {
    try {
      return await fs.readFile(userSettingsPath(), 'utf8')
    } catch (error) {
      // No file yet is the ordinary first-run state, not a failure.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  })

  ipcMain.handle(
    channels.writeUserSettings,
    async (_event, contents: string) => {
      const target = userSettingsPath()
      await fs.mkdir(path.dirname(target), { recursive: true })
      // Write then rename, so a crash mid-write leaves the previous settings
      // intact rather than a truncated file the app will refuse to parse.
      const temporary = `${target}.tmp`
      await fs.writeFile(temporary, contents, 'utf8')
      await fs.rename(temporary, target)
    }
  )

  /**
   * Start a device authorization.
   *
   * Runs in the main process because the token exchange must not be reachable
   * from the renderer: the renderer gets a user code to display and nothing
   * else, and the access token is only ever returned once the user has
   * confirmed out of band.
   */
  ipcMain.handle(
    channels.startDeviceFlow,
    async (event, host: string): Promise<DeviceAuthorization> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) throw new Error('No window is available for signing in.')

      abortDeviceFlow(window.id)

      const configuration = new Configuration(
        {
          issuer: host,
          device_authorization_endpoint: `${host}/oauth2/device/auth`,
          token_endpoint: `${host}/oauth2/device/token`,
        },
        DEVICE_CLIENT_ID,
        undefined,
        // A device-flow client is public, so there is no client authentication.
        None()
      )

      const authorization = await initiateDeviceAuthorization(configuration, {})
      const verificationUri =
        authorization.verification_uri_complete ??
        authorization.verification_uri
      if (!verificationUri) {
        throw new Error('The identity provider returned no verification URL.')
      }

      const controller = new AbortController()
      deviceFlows.set(window.id, {
        abort: () => controller.abort(),
        verificationUri,
        poll: () =>
          pollDeviceAuthorizationGrant(
            configuration,
            authorization,
            {},
            {
              signal: controller.signal,
            }
          ),
      })

      return {
        userCode: authorization.user_code ?? '',
        verificationUri,
      }
    }
  )

  /** Open the verification page, then wait for the user to confirm. */
  ipcMain.handle(
    channels.completeDeviceFlow,
    async (event): Promise<string | null> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const session = window ? deviceFlows.get(window.id) : undefined
      if (!window || !session) {
        throw new Error('No sign-in is in progress.')
      }

      const target = new URL(session.verificationUri)
      if (target.protocol !== 'https:' && target.protocol !== 'http:') {
        throw new Error('Refusing to open a non-web verification URL.')
      }
      await shell.openExternal(target.toString())

      try {
        const tokens = await session.poll()
        return tokens.access_token ?? null
      } finally {
        // Whether it succeeded, failed, or was aborted, this attempt is over.
        if (deviceFlows.get(window.id) === session) {
          deviceFlows.delete(window.id)
        }
      }
    }
  )

  ipcMain.handle(channels.cancelDeviceFlow, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) abortDeviceFlow(window.id)
  })

  ipcMain.handle(channels.openExternal, async (_event, url: string) => {
    const parsed = new URL(url)
    // Only http(s) ever reaches the OS. Other schemes can launch a local
    // handler with renderer-supplied arguments.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Refusing to open a non-web URL: ${url}`)
    }
    await shell.openExternal(parsed.toString())
  })
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 680,
    minHeight: 480,
    // Matches --zds-surface-chassis in dark, so startup is not a white flash
    // before the renderer's stylesheet lands.
    backgroundColor: '#111316',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  })

  // Show only once there is something to look at.
  window.once('ready-to-show', () => window.show())

  // Window-scoped work must die with the window, or polling outlives the UI
  // that started it.
  window.on('closed', () => abortDeviceFlow(window.id))

  // External links go to the OS browser; this window never navigates away from
  // the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    void window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    )
  }

  return window
}

app.whenReady().then(
  () => {
    // In development the dev server supplies its own policy through the meta
    // tag; a second one here would block Vite's HMR client.
    if (!isDevelopment) {
      session.defaultSession.webRequest.onHeadersReceived(
        (details, callback) => {
          callback({
            responseHeaders: {
              ...details.responseHeaders,
              'Content-Security-Policy': [contentSecurityPolicy],
            },
          })
        }
      )
    }

    void loadGrantedRoots()
    registerIpcHandlers()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  },
  (error) => {
    console.error('Failed to start the app', error)
    app.quit()
  }
)

app.on('window-all-closed', () => {
  // macOS convention is to keep the app running with no windows open.
  if (os.platform() !== 'darwin') app.quit()
})
