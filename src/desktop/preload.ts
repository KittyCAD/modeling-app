/**
 * Preload script: the only bridge between the renderer and the main process.
 *
 * The renderer gets named, typed methods — never `ipcRenderer` itself, and
 * never a channel name it could pick. That keeps the trust boundary readable:
 * everything the renderer can ask the OS to do is listed right here.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { type DirectoryEntry, type FileStatResult, channels } from './channels'

const desktop = {
  platform: process.platform,

  /** The default projects directory, and the first granted root. */
  projectsDirectory: (): Promise<string> =>
    ipcRenderer.invoke(channels.projectsDirectory),

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
}

export type DesktopBridge = typeof desktop

contextBridge.exposeInMainWorld('electron', desktop)
