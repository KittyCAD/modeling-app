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
import { BrowserWindow, app, dialog, ipcMain, session, shell } from 'electron'
import { type DirectoryEntry, channels } from './channels'

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
  "img-src 'self' blob: data:",
  "connect-src 'self' https://api.zoo.dev wss://api.zoo.dev https://api.dev.zoo.dev wss://api.dev.zoo.dev",
  "object-src 'none'",
  "frame-src 'none'",
].join('; ')

// ---------------------------------------------------------------------------
// Projects directory
// ---------------------------------------------------------------------------

let projectsDirectory: string | null = null

async function ensureProjectsDirectory(): Promise<string> {
  projectsDirectory ??= path.join(app.getPath('documents'), 'Zoo Design Studio')
  await fs.mkdir(projectsDirectory, { recursive: true })
  return projectsDirectory
}

/**
 * Confine a renderer-supplied path to the projects directory.
 *
 * Every filesystem channel goes through this. The renderer is the least
 * trusted part of a desktop app — it will eventually run third-party plugin
 * code — so a path it supplies must not be able to reach the rest of the disk,
 * whether through `..`, an absolute path, or a symlink pointing out of the tree.
 */
async function resolveInsideProjects(requested: string): Promise<string> {
  const realRoot = await fs.realpath(await ensureProjectsDirectory())
  const resolved = path.resolve(realRoot, requested)

  // Check the resolved path first, so a file that does not exist yet is still
  // validated before anything tries to create it.
  const relative = path.relative(realRoot, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the projects directory: ${requested}`)
  }

  // Then check what it really points at, to catch a symlink out of the tree.
  try {
    const real = await fs.realpath(resolved)
    const realRelative = path.relative(realRoot, real)
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new Error(
        `Path resolves outside the projects directory: ${requested}`
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
// IPC
// ---------------------------------------------------------------------------

function registerIpcHandlers() {
  ipcMain.handle(channels.projectsDirectory, () => ensureProjectsDirectory())

  ipcMain.handle(channels.chooseProjectsDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a projects folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: await ensureProjectsDirectory(),
    })
    if (result.canceled || result.filePaths.length === 0) return null
    projectsDirectory = result.filePaths[0]
    return projectsDirectory
  })

  ipcMain.handle(channels.readFile, async (_event, target: string) => {
    const file = await resolveInsideProjects(target)
    // A plain array, not a Buffer: Buffers arrive over IPC as serialised
    // objects, and the renderer wants bytes it can hand to a Uint8Array.
    return Array.from(await fs.readFile(file))
  })

  ipcMain.handle(channels.readTextFile, async (_event, target: string) =>
    fs.readFile(await resolveInsideProjects(target), 'utf8')
  )

  ipcMain.handle(
    channels.writeTextFile,
    async (_event, target: string, contents: string) => {
      const file = await resolveInsideProjects(target)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, contents, 'utf8')
    }
  )

  ipcMain.handle(channels.exists, async (_event, target: string) => {
    try {
      await fs.stat(await resolveInsideProjects(target))
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(
    channels.readDirectory,
    async (_event, target: string): Promise<DirectoryEntry[]> => {
      const directory = await resolveInsideProjects(target)
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
      const root = await resolveInsideProjects(target)

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
    await fs.mkdir(await resolveInsideProjects(target), { recursive: true })
  })

  ipcMain.handle(channels.remove, async (_event, target: string) => {
    // Trash rather than unlink: losing a project to a misrouted delete is not
    // something the person who did it can undo.
    await shell.trashItem(await resolveInsideProjects(target))
  })

  ipcMain.handle(channels.rename, async (_event, from: string, to: string) => {
    await fs.rename(
      await resolveInsideProjects(from),
      await resolveInsideProjects(to)
    )
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
