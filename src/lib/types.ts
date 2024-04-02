import { type FileInfo } from '@tauri-apps/plugin-fs'

export type IndexLoaderData = {
  code: string | null
  project?: ProjectWithEntryPointMetadata
  file?: FileEntry
}

export type FileLoaderData = {
  code: string | null
  project?: FileEntry | ProjectWithEntryPointMetadata
  file?: FileEntry
}

export type ProjectWithEntryPointMetadata = FileEntry & {
  entrypointMetadata: FileInfo
}
export type HomeLoaderData = {
  projects: ProjectWithEntryPointMetadata[]
}

// From https://github.com/tauri-apps/tauri/blob/1.x/tooling/api/src/fs.ts#L159
// Removed from tauri v2
export interface FileEntry {
  path: string
  /**
   * Name of the directory/file
   * can be null if the path terminates with `..`
   */
  name?: string
  /** Children of this entry if it's a directory; null otherwise */
  children?: FileEntry[]
}

// From the very helpful @jcalz on StackOverflow: https://stackoverflow.com/a/58436959/22753272
type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${'' extends P ? '' : '.'}${P}`
    : never
  : never

type Prev = [
  never,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  ...0[]
]

export type Paths<T, D extends number = 10> = [D] extends [never]
  ? never
  : T extends object
  ? {
      [K in keyof T]-?: K extends string | number
        ? `${K}` | Join<K, Paths<T[K], Prev[D]>>
        : never
    }[keyof T]
  : ''

type Idx<T, K> = K extends keyof T
  ? T[K]
  : number extends keyof T
  ? K extends `${number}`
    ? T[number]
    : never
  : never

export type PathValue<
  T,
  P extends Paths<T, 1>
> = P extends `${infer Key}.${infer Rest}`
  ? Rest extends Paths<Idx<T, Key>, 1>
    ? PathValue<Idx<T, Key>, Rest>
    : never
  : Idx<T, P>

export type Leaves<T, D extends number = 10> = [D] extends [never]
  ? never
  : T extends object
  ? { [K in keyof T]-?: Join<K, Leaves<T[K], Prev[D]>> }[keyof T]
  : ''

// Thanks to @micfan on StackOverflow for this utility type:
// https://stackoverflow.com/a/57390160/22753272
export type AtLeast<T, K extends keyof T> = Partial<T> & Pick<T, K>

export function isEnumMember<T extends Record<string, unknown>>(
  v: unknown,
  e: T
) {
  return Object.values(e).includes(v)
}
