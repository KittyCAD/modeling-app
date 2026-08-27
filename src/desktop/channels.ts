/**
 * The desktop IPC surface.
 *
 * One list of channel names shared by the main process and the preload script,
 * so a typo is a type error rather than a silently dead handler. Renderer code
 * never sees these — it only sees the methods `preload.ts` exposes.
 */
export const channels = {
  /** Absolute path of the directory projects live in. */
  projectsDirectory: 'fs:projectsDirectory',
  /** Ask the user to choose a different projects directory. */
  chooseProjectsDirectory: 'fs:chooseProjectsDirectory',
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
} as const

export type Channel = (typeof channels)[keyof typeof channels]

export interface DirectoryEntry {
  name: string
  kind: 'file' | 'directory'
}
