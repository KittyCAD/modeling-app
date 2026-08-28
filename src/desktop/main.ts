/**
 * Electron main process.
 *
 * Deliberately small. It owns the window, the security policy, and privileged
 * filesystem access — nothing else. Application behaviour lives in the
 * renderer, where the registry can compose it; anything that leaks in here
 * becomes a capability no feature can see or replace.
 */

import { type FSWatcher, watch as watchPath } from 'node:fs'
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
  type FileChangeKind,
  type WatchedFileChange,
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

/** Where the user's keymap lives, next to their settings. */
function keymapPath(): string {
  return path.join(app.getPath('userData'), 'keybindings.toml')
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
// Watching
// ---------------------------------------------------------------------------

/**
 * How long to gather raw events before reporting them.
 *
 * One save from another editor can produce a create, a rename and two writes,
 * and the file is not readable at every point in between. Waiting for the burst
 * to end and then reporting once is the difference between reconciling a
 * document and reconciling a half-written one.
 */
const WATCH_COALESCE_MS = 120

/** Never worth reporting: churn, or our own atomic-write scratch files. */
const IGNORED_SEGMENTS = new Set(['.git', 'node_modules', '.DS_Store'])

function isIgnoredWatchTarget(relativePath: string): boolean {
  if (relativePath.endsWith('.tmp')) return true
  return relativePath
    .split(path.sep)
    .some((segment) => IGNORED_SEGMENTS.has(segment))
}

interface Subscription {
  id: number
  root: string
  webContentsId: number
  watcher: FSWatcher | null
  /** Coalescing buffer: path -> whether a rename was seen for it. */
  pending: Map<string, boolean>
  timer: NodeJS.Timeout | null
}

const subscriptions = new Map<number, Subscription>()
let nextSubscriptionId = 1

/**
 * Decide what actually happened, once the burst has settled.
 *
 * `fs.watch` reports 'rename' for both creation and deletion and 'change' for
 * writes, so the event alone cannot say which. Statting at flush time can: the
 * answer is about the file's state now, not about the sequence of syscalls that
 * got it there.
 */
async function resolveChangeKind(
  absolutePath: string,
  sawRename: boolean
): Promise<FileChangeKind | null> {
  try {
    await fs.stat(absolutePath)
    return sawRename ? 'created' : 'changed'
  } catch {
    // Only a rename can mean removal; a failed stat after a plain write is a
    // race we should stay quiet about.
    return sawRename ? 'removed' : null
  }
}

async function flushSubscription(subscription: Subscription) {
  subscription.timer = null
  const batch = [...subscription.pending.entries()]
  subscription.pending.clear()

  const changes: WatchedFileChange[] = []
  for (const [absolutePath, sawRename] of batch) {
    const kind = await resolveChangeKind(absolutePath, sawRename)
    if (kind) changes.push({ path: absolutePath, kind })
  }
  if (changes.length === 0) return

  const target = BrowserWindow.getAllWindows().find(
    (window) => window.webContents.id === subscription.webContentsId
  )
  if (!target || target.isDestroyed()) return

  target.webContents.send(channels.fileChanges, {
    subscriptionId: subscription.id,
    changes,
  })
}

function stopSubscription(id: number) {
  const subscription = subscriptions.get(id)
  if (!subscription) return
  if (subscription.timer) clearTimeout(subscription.timer)
  subscription.watcher?.close()
  subscriptions.delete(id)
}

function stopSubscriptionsFor(webContentsId: number) {
  for (const [id, subscription] of subscriptions) {
    if (subscription.webContentsId === webContentsId) stopSubscription(id)
  }
}

/**
 * Watch a granted directory tree for one renderer.
 *
 * Recursive where the platform supports it, and a single non-recursive watch
 * otherwise. A subscription is still handed back if the watch cannot be
 * established at all, so the renderer has something to dispose and does not
 * have to model "watching failed" as a separate state.
 */
async function startSubscription(
  webContentsId: number,
  requested: string
): Promise<number> {
  const root = await resolveGranted(requested)
  const subscription: Subscription = {
    id: nextSubscriptionId,
    root,
    webContentsId,
    watcher: null,
    pending: new Map(),
    timer: null,
  }
  nextSubscriptionId += 1
  subscriptions.set(subscription.id, subscription)

  const onEvent = (eventType: string, filename: string | null) => {
    if (!filename) return
    if (isIgnoredWatchTarget(filename)) return

    const absolutePath = path.resolve(root, filename)
    const sawRename =
      (subscription.pending.get(absolutePath) ?? false) ||
      eventType === 'rename'
    subscription.pending.set(absolutePath, sawRename)

    if (subscription.timer) clearTimeout(subscription.timer)
    subscription.timer = setTimeout(() => {
      void flushSubscription(subscription)
    }, WATCH_COALESCE_MS)
  }

  try {
    subscription.watcher = watchPath(root, { recursive: true }, onEvent)
  } catch {
    try {
      subscription.watcher = watchPath(root, onEvent)
    } catch (error) {
      console.warn(`watch: could not watch ${root}`, error)
      return subscription.id
    }
  }

  // A watch on a directory that goes away should not take the process with it.
  subscription.watcher.on('error', (error) => {
    console.warn(`watch: ${root} failed`, error)
    stopSubscription(subscription.id)
  })

  return subscription.id
}

/**
 * Watch the user's settings file.
 *
 * The directory is watched rather than the file, because an atomic write
 * replaces the inode and a watch on the old one goes deaf. Main compares the
 * result against what it last wrote and stays quiet when they match, so the
 * renderer only ever hears about edits it did not cause.
 */
let lastWrittenUserSettings: string | null = null
let userSettingsWatcher: FSWatcher | null = null

function startUserSettingsWatch() {
  if (userSettingsWatcher) return
  const target = userSettingsPath()
  const directory = path.dirname(target)

  let timer: NodeJS.Timeout | null = null
  const check = async () => {
    timer = null
    let contents: string | null = null
    try {
      contents = await fs.readFile(target, 'utf8')
    } catch {
      contents = null
    }
    if (contents === lastWrittenUserSettings) return
    lastWrittenUserSettings = contents

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channels.userSettingsChanged, contents)
      }
    }
  }

  try {
    userSettingsWatcher = watchPath(directory, (_event, filename) => {
      if (filename !== path.basename(target)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void check(), WATCH_COALESCE_MS)
    })
    userSettingsWatcher.on('error', (error) => {
      console.warn('watch: user settings failed', error)
      userSettingsWatcher = null
    })
  } catch (error) {
    // The configuration directory always exists in practice, but a build that
    // cannot watch it should still run.
    console.warn('watch: could not watch the settings directory', error)
  }
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
    channels.readTextFileIfPresent,
    async (_event, target: string) => {
      const file = await resolveGranted(target)
      try {
        return await fs.readFile(file, 'utf8')
      } catch (error) {
        // Absent is an answer, not a failure. Anything else still throws:
        // a file we may not read is not a file that is not there.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    }
  )

  ipcMain.handle(
    channels.writeFile,
    async (_event, target: string, contents: number[]) => {
      const file = await resolveGranted(target)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, Uint8Array.from(contents))
    }
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
  ipcMain.handle(channels.keymapPath, () => keymapPath())

  ipcMain.handle(channels.readKeymap, async () => {
    try {
      return await fs.readFile(keymapPath(), 'utf8')
    } catch (error) {
      // No keymap yet is the ordinary state: most people never write one.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  })

  ipcMain.handle(channels.writeKeymap, async (_event, contents: string) => {
    const target = keymapPath()
    await fs.mkdir(path.dirname(target), { recursive: true })
    // Write then rename, as with settings: a crash mid-write leaves the previous
    // keymap intact rather than a truncated file that would parse as empty and
    // silently restore every default.
    const temporary = `${target}.tmp`
    await fs.writeFile(temporary, contents, 'utf8')
    await fs.rename(temporary, target)
  })

  ipcMain.handle(channels.readUserSettings, async () => {
    try {
      const contents = await fs.readFile(userSettingsPath(), 'utf8')
      lastWrittenUserSettings = contents
      return contents
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
      // Recorded before the write, so the watcher recognises the result as ours
      // however quickly it fires.
      lastWrittenUserSettings = contents
      // Write then rename, so a crash mid-write leaves the previous settings
      // intact rather than a truncated file the app will refuse to parse.
      const temporary = `${target}.tmp`
      await fs.writeFile(temporary, contents, 'utf8')
      await fs.rename(temporary, target)
    }
  )

  ipcMain.handle(
    channels.watchDirectory,
    async (event, target: string) =>
      await startSubscription(event.sender.id, target)
  )

  ipcMain.handle(channels.unwatchDirectory, (event, id: number) => {
    const subscription = subscriptions.get(id)
    // A renderer may only stop a watch it started.
    if (subscription?.webContentsId === event.sender.id) stopSubscription(id)
  })

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
  //
  // Both ids are read here, while the window is alive, rather than inside the
  // handler. By the time `closed` fires the native object is gone, and
  // `window.webContents` is a getter into it — reaching for it throws "Object
  // has been destroyed", which on quit is an uncaught exception in the main
  // process and so an OS error dialog on the way out.
  const windowId = window.id
  const webContentsId = window.webContents.id

  window.on('closed', () => {
    abortDeviceFlow(windowId)
    stopSubscriptionsFor(webContentsId)
  })

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
    startUserSettingsWatch()
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

/**
 * Release every watch on the way out.
 *
 * An open `fs.watch` handle keeps the event loop alive, so a quit with watches
 * still running is a process that lingers after its window has gone.
 */
app.on('will-quit', () => {
  userSettingsWatcher?.close()
  userSettingsWatcher = null
  for (const id of [...subscriptions.keys()]) stopSubscription(id)
})
