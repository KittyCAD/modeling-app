import { posix } from '@chainner/node-path'
import { isArray } from '@src/lib/utils'

/** The Projects API stores files; this file preserves otherwise empty directories. */
export const CLOUD_DIRECTORIES_FILE = '.zoo-directories.json'

export function decodeCloudDirectories(bytes: Uint8Array): string[] {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (
    !isArray(value) ||
    !value.every(
      (path): path is string =>
        typeof path === 'string' &&
        path.length > 0 &&
        path !== '.' &&
        path !== '..' &&
        !path.startsWith('../') &&
        !path.startsWith('/') &&
        !path.includes('\\') &&
        !path.includes('\0') &&
        !/^[a-z]:/i.test(path) &&
        posix.normalize(path) === path &&
        path !== CLOUD_DIRECTORIES_FILE &&
        !path.startsWith(`${CLOUD_DIRECTORIES_FILE}/`)
    )
  ) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error(
      'Cloud directory metadata contains an invalid project path.'
    )
  }
  return [...new Set(value)]
}

export function encodeCloudDirectories(
  paths: readonly string[]
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify([...new Set(paths)].sort()))
}
