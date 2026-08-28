/**
 * Preload script: the only bridge between the renderer and the main process.
 *
 * The renderer gets named, typed methods — never `ipcRenderer` itself, and
 * never a channel name it could pick. That keeps the trust boundary readable:
 * everything the renderer can ask the OS to do is listed right here.
 */

import { contextBridge, ipcRenderer } from 'electron'
import {
  channels,
  type DeviceAuthorization,
  type DirectoryEntry,
  type FileChangesPayload,
  type FileStatResult,
} from './channels'

const desktop = {
  platform: process.platform,

  /** The default projects directory, and the first granted root. */
  projectsDirectory: (): Promise<string> =>
    ipcRenderer.invoke(channels.projectsDirectory),

  /** The app-managed local materialization directory for Personal Cloud. */
  cloudProjectsDirectory: (): Promise<string> =>
    ipcRenderer.invoke(channels.cloudProjectsDirectory),

  /** Every directory the user has granted access to. */
  grantedRoots: (): Promise<string[]> =>
    ipcRenderer.invoke(channels.grantedRoots),

  /**
   * Prompt for a directory. Choosing one grants access to it, which is how a
   * library outside the default projects directory becomes reachable.
   */
  chooseDirectory: (options?: {
    title?: string
    defaultPath?: string
  }): Promise<string | null> =>
    ipcRenderer.invoke(channels.chooseDirectory, options ?? {}),

  stat: (path: string): Promise<FileStatResult> =>
    ipcRenderer.invoke(channels.stat, path),

  /** Bytes of a file. */
  readFile: async (path: string): Promise<Uint8Array> =>
    // Rebuilt here so callers get a real Uint8Array rather than the array that
    // survived structured cloning.
    Uint8Array.from(await ipcRenderer.invoke(channels.readFile, path)),

  readTextFile: (path: string): Promise<string> =>
    ipcRenderer.invoke(channels.readTextFile, path),

  readTextFileIfPresent: (path: string): Promise<string | null> =>
    ipcRenderer.invoke(channels.readTextFileIfPresent, path),

  writeFile: (path: string, contents: Uint8Array): Promise<void> =>
    ipcRenderer.invoke(channels.writeFile, path, Array.from(contents)),

  writeTextFile: (path: string, contents: string): Promise<void> =>
    ipcRenderer.invoke(channels.writeTextFile, path, contents),

  exists: (path: string): Promise<boolean> =>
    ipcRenderer.invoke(channels.exists, path),

  readDirectory: (path: string): Promise<DirectoryEntry[]> =>
    ipcRenderer.invoke(channels.readDirectory, path),

  listFilesRecursive: (path: string): Promise<string[]> =>
    ipcRenderer.invoke(channels.listFilesRecursive, path),

  makeDirectory: (path: string): Promise<void> =>
    ipcRenderer.invoke(channels.makeDirectory, path),

  /** Moves to the OS trash rather than deleting outright. */
  remove: (path: string): Promise<void> =>
    ipcRenderer.invoke(channels.remove, path),

  rename: (from: string, to: string): Promise<void> =>
    ipcRenderer.invoke(channels.rename, from, to),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(channels.openExternal, url),

  /** Absolute path of `user.toml`, shown so someone can go and edit it. */
  userSettingsPath: (): Promise<string> =>
    ipcRenderer.invoke(channels.userSettingsPath),
  keymapPath: (): Promise<string> => ipcRenderer.invoke(channels.keymapPath),
  readKeymap: (): Promise<string | null> =>
    ipcRenderer.invoke(channels.readKeymap),
  writeKeymap: (contents: string): Promise<void> =>
    ipcRenderer.invoke(channels.writeKeymap, contents),

  /** TOML text of the user's settings, or null if the file does not exist. */
  readUserSettings: (): Promise<string | null> =>
    ipcRenderer.invoke(channels.readUserSettings),

  writeUserSettings: (contents: string): Promise<void> =>
    ipcRenderer.invoke(channels.writeUserSettings, contents),

  /**
   * Listen for settings edits made outside the app.
   *
   * Only fires for edits the main process did not make itself, so the renderer
   * never has to tell its own save apart from someone's text editor. Returns an
   * unsubscribe function: a listener the renderer cannot remove is a leak it
   * cannot fix.
   */
  onUserSettingsChanged: (
    listener: (contents: string | null) => void
  ): (() => void) => {
    const handler = (_event: unknown, contents: string | null) =>
      listener(contents)
    ipcRenderer.on(channels.userSettingsChanged, handler)
    return () => ipcRenderer.off(channels.userSettingsChanged, handler)
  },

  /** Begin watching a directory tree. Resolves with a subscription id. */
  watchDirectory: (path: string): Promise<number> =>
    ipcRenderer.invoke(channels.watchDirectory, path),

  unwatchDirectory: (subscriptionId: number): Promise<void> =>
    ipcRenderer.invoke(channels.unwatchDirectory, subscriptionId),

  /** Coalesced batches of filesystem changes, for every active subscription. */
  onFileChanges: (
    listener: (payload: FileChangesPayload) => void
  ): (() => void) => {
    const handler = (_event: unknown, payload: FileChangesPayload) =>
      listener(payload)
    ipcRenderer.on(channels.fileChanges, handler)
    return () => ipcRenderer.off(channels.fileChanges, handler)
  },

  /** Begin signing in. Returns the code for the user to enter. */
  startDeviceFlow: (host: string): Promise<DeviceAuthorization> =>
    ipcRenderer.invoke(channels.startDeviceFlow, host),

  /**
   * Open the verification page and wait for confirmation.
   *
   * Resolves with an access token, or null if the provider declined. The token
   * exchange happens in the main process; the renderer never sees the device
   * code secret.
   */
  completeDeviceFlow: (): Promise<string | null> =>
    ipcRenderer.invoke(channels.completeDeviceFlow),

  cancelDeviceFlow: (): Promise<void> =>
    ipcRenderer.invoke(channels.cancelDeviceFlow),
}

export type DesktopBridge = typeof desktop

contextBridge.exposeInMainWorld('electron', desktop)
