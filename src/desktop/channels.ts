/**
 * The desktop IPC surface.
 *
 * One list of channel names shared by the main process and the preload script,
 * so a typo is a type error rather than a silently dead handler. Renderer code
 * never sees these — it only sees the methods `preload.ts` exposes.
 */
export const channels = {
  /** Absolute path of the default directory projects live in. */
  projectsDirectory: 'fs:projectsDirectory',
  /**
   * Ask the user to pick a directory. Choosing one grants access to it, so this
   * is the only way a path outside the default projects directory becomes
   * reachable.
   */
  chooseDirectory: 'fs:chooseDirectory',
  /** Directories the user has granted access to. */
  grantedRoots: 'fs:grantedRoots',
  stat: 'fs:stat',
  readFile: 'fs:readFile',
  readTextFile: 'fs:readTextFile',
  writeTextFile: 'fs:writeTextFile',
  exists: 'fs:exists',
  /** Immediate children of a directory, with their kind. */
  readDirectory: 'fs:readDirectory',
  /** Every file beneath a directory, recursively, as relative paths. */
  listFilesRecursive: 'fs:listFilesRecursive',
  makeDirectory: 'fs:makeDirectory',
  remove: 'fs:remove',
  rename: 'fs:rename',
  openExternal: 'shell:openExternal',

  /**
   * The user's settings file, in the app's configuration directory.
   *
   * Deliberately not reachable through the filesystem channels: those only
   * serve directories the user has granted, and the configuration directory is
   * not one of them. Pinning the path in the main process means the renderer
   * cannot ask for a different file.
   */
  userSettingsPath: 'settings:path',
  readUserSettings: 'settings:read',
  writeUserSettings: 'settings:write',
  /**
   * Pushed when the settings file changes underneath us.
   *
   * Main -> renderer, and only for edits main did not make itself: it knows what
   * it last wrote, so it can tell an external edit from its own echo before the
   * renderer ever hears about it.
   */
  userSettingsChanged: 'settings:changed',

  /** Begin watching a directory tree. Resolves with a subscription id. */
  watchDirectory: 'fs:watch',
  unwatchDirectory: 'fs:unwatch',
  /** Main -> renderer: a coalesced batch of changes for one subscription. */
  fileChanges: 'fs:changed',

  /** Begin an OAuth2 device authorization, returning the code to show. */
  startDeviceFlow: 'auth:startDeviceFlow',
  /** Open the verification page and poll until the user confirms. */
  completeDeviceFlow: 'auth:completeDeviceFlow',
  cancelDeviceFlow: 'auth:cancelDeviceFlow',
} as const

export type Channel = (typeof channels)[keyof typeof channels]

export interface DirectoryEntry {
  name: string
  kind: 'file' | 'directory'
}

export interface DeviceAuthorization {
  userCode: string
  verificationUri: string
}

export type FileChangeKind = 'created' | 'changed' | 'removed'

export interface WatchedFileChange {
  path: string
  kind: FileChangeKind
}

export interface FileChangesPayload {
  subscriptionId: number
  changes: WatchedFileChange[]
}

export interface FileStatResult {
  kind: 'file' | 'directory'
  size: number
  modifiedAt: number
}
