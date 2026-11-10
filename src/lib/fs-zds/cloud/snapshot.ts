import { posix } from '@chainner/node-path'
import type { MemoryFileSystem } from '@src/lib/fs-zds/memory'
import type { ProjectArchiveFile } from '@src/lib/fs-zds/cloud/types'
import {
  CLOUD_DIRECTORIES_FILE,
  decodeCloudDirectories,
  encodeCloudDirectories,
} from '@src/lib/fs-zds/cloud/directories'

/** Reading a snapshot synthesizes empty-directory metadata without mutating storage. */
export async function collectCloudSnapshot(
  memory: MemoryFileSystem,
  root: string
): Promise<ProjectArchiveFile[]> {
  const files: ProjectArchiveFile[] = []
  const empty: string[] = []
  const pending = [root]
  while (pending.length) {
    const directory = pending.pop()!
    const names = (await memory.readdir(directory)).filter(
      (name) => directory !== root || name !== CLOUD_DIRECTORIES_FILE
    )
    if (directory !== root && !names.length)
      empty.push(memory.relative(root, directory).replaceAll('\\', '/'))
    for (const name of names) {
      const path = memory.join(directory, name)
      if (((await memory.stat(path)).mode & 0o170000) === 0o040000)
        pending.push(path)
      else
        files.push({
          relativePath: memory.relative(root, path).replaceAll('\\', '/'),
          data: await memory.readFile(path),
        })
    }
  }
  if (empty.length)
    files.push({
      relativePath: CLOUD_DIRECTORIES_FILE,
      data: encodeCloudDirectories(empty),
    })
  return files
}

/** Validate original names and publish files and empty directories in one memory replacement. */
export function replaceCloudSnapshot(
  memory: MemoryFileSystem,
  root: string,
  archive: readonly ProjectArchiveFile[]
): void {
  const files = archive.map(({ relativePath, data }) => {
    if (
      !relativePath ||
      relativePath === '.' ||
      relativePath === '..' ||
      relativePath.startsWith('../') ||
      relativePath.startsWith('/') ||
      relativePath.includes('\\') ||
      relativePath.includes('\0') ||
      relativePath.endsWith('/') ||
      /^[a-z]:/i.test(relativePath) ||
      posix.normalize(relativePath) !== relativePath
    ) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw new Error('Cloud archive contains a path outside its project.')
    }
    return { path: memory.resolve(root, relativePath), data }
  })
  const metadata = archive.find(
    (file) => file.relativePath === CLOUD_DIRECTORIES_FILE
  )
  const directories = metadata ? decodeCloudDirectories(metadata.data) : []
  memory.replaceDirectory(
    root,
    files,
    directories.map((path) => memory.resolve(root, path))
  )
}

export function sameSnapshot(
  left: readonly ProjectArchiveFile[],
  right: readonly ProjectArchiveFile[]
): boolean {
  if (left.length !== right.length) return false
  const expected = new Map(left.map((file) => [file.relativePath, file.data]))
  if (expected.size !== left.length) return false
  for (const file of right) {
    const bytes = expected.get(file.relativePath)
    if (
      !bytes ||
      bytes.length !== file.data.length ||
      !bytes.every((byte, index) => byte === file.data[index])
    )
      return false
    expected.delete(file.relativePath)
  }
  return expected.size === 0
}
