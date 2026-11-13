import { posix as paths } from '@chainner/node-path'
import type {
  ProjectArchiveFile,
  RemoteProject,
  RemoteProjectFile,
} from '@src/lib/cloudProjects/runtime/types'

export interface CloudRefreshPlan {
  readonly selected: readonly RemoteProjectFile[]
  merge: (
    downloaded: readonly ProjectArchiveFile[]
  ) => ProjectArchiveFile[] | Error
}

/** Reuse acknowledged bytes; select only additions and changed files from the new version. */
export function planCloudRefresh(
  previous: RemoteProject,
  next: RemoteProject,
  current: readonly ProjectArchiveFile[]
): CloudRefreshPlan | Error {
  if (!previous.files || !next.files) {
    return new Error('Cloud refresh requires project file metadata.')
  }
  const previousFiles = new Map(
    previous.files.map((file) => [file.relative_path, file])
  )
  const contents = new Map(
    current.map((file) => [file.relativePath, file.data])
  )
  const retained = new Map<string, Uint8Array>()
  const selected: RemoteProjectFile[] = []
  const seenPaths = new Set<string>()
  const ids = new Set<string>()
  for (const file of next.files) {
    if (
      !file.id ||
      ids.has(file.id) ||
      seenPaths.has(file.relative_path) ||
      !file.relative_path ||
      file.relative_path.includes('\\') ||
      file.relative_path.startsWith('/') ||
      /^[a-z]:/i.test(file.relative_path) ||
      file.relative_path === '..' ||
      file.relative_path.startsWith('../') ||
      file.relative_path.endsWith('/') ||
      paths.normalize(file.relative_path) !== file.relative_path ||
      !Number.isSafeInteger(file.byte_size) ||
      file.byte_size < 0
    ) {
      return new Error(
        'Cloud file metadata contains an invalid or duplicate project path, ID, or size.'
      )
    }
    seenPaths.add(file.relative_path)
    ids.add(file.id)
    const old = previousFiles.get(file.relative_path)
    const bytes = contents.get(file.relative_path)
    const unchanged =
      old &&
      old.byte_size === file.byte_size &&
      ((file.sha256 && file.sha256 === old.sha256) ||
        (previous.revision === next.revision && file.id === old.id))
    if (unchanged && bytes && bytes.byteLength === file.byte_size)
      retained.set(file.relative_path, bytes)
    else selected.push(file)
  }
  return {
    selected,
    merge(downloaded) {
      const expected = new Map(
        selected.map((file) => [file.relative_path, file])
      )
      const result = new Map(retained)
      for (const file of downloaded) {
        const metadata = expected.get(file.relativePath)
        if (!metadata || file.data.byteLength !== metadata.byte_size) {
          return new Error(
            'Cloud refresh archive does not match the selected version files.'
          )
        }
        expected.delete(file.relativePath)
        result.set(file.relativePath, file.data)
      }
      if (expected.size) {
        return new Error(
          'Cloud refresh archive is missing selected version files.'
        )
      }
      return [...result].map(([relativePath, data]) => ({ relativePath, data }))
    },
  }
}
