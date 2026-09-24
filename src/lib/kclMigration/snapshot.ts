import { INTERNAL_OPFS_META_FILE } from '@src/lib/cloudSync/paths'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { MAX_BYTES, MAX_FILES } from '@src/lib/kclMigration/protocol'
import { webSafePathSplit } from '@src/lib/pathUtils'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

export type ProjectFiles = Map<string, Uint8Array>
export type SnapshotIO = Pick<
  FileOperationsRegistryService,
  'readDirectory' | 'readFile' | 'stat'
>
export type ProjectPaths = Pick<
  IZooDesignStudioFS,
  'join' | 'relative' | 'resolve' | 'extname'
>

export function validProjectPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !/[\\:\0]/.test(path) &&
    webSafePathSplit(path).every(
      (part) => part !== '' && part !== '.' && part !== '..'
    )
  )
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, i) => byte === right[i])
  )
}

export function equalFiles(left: ProjectFiles, right: ProjectFiles): boolean {
  return (
    left.size === right.size &&
    [...left].every(([name, bytes]) => {
      const other = right.get(name)
      return other !== undefined && equalBytes(bytes, other)
    })
  )
}

/** Read every project file, including files ignored by the ordinary chat collector. */
export async function readProjectFiles(
  io: SnapshotIO,
  paths: ProjectPaths,
  root: string
): Promise<ProjectFiles> {
  if ((await io.stat(root, { followSymlinks: false })).symbolicLink) {
    return Promise.reject(
      new Error(
        'Migration does not support symbolic links. Open the original project directory.'
      )
    )
  }
  const files: ProjectFiles = new Map()
  const names = new Set<string>()
  let bytes = 0
  let entries = 0
  async function visit(directory: string): Promise<void> {
    for (const name of (await io.readDirectory(directory)).toSorted()) {
      if (name === '.git' || name === INTERNAL_OPFS_META_FILE) continue
      const absolute = paths.join(directory, name)
      const relative = paths.relative(root, absolute).replaceAll('\\', '/')
      if (!validProjectPath(relative) || names.has(relative.toLowerCase())) {
        return Promise.reject(
          new Error(`Unsupported or ambiguous project path: ${relative}`)
        )
      }
      names.add(relative.toLowerCase())
      entries += 1
      if (entries > MAX_FILES * 4) {
        return Promise.reject(
          new Error('The project has too many directory entries to migrate.')
        )
      }
      const stat = await io.stat(absolute, { followSymlinks: false })
      if (stat.symbolicLink) {
        return Promise.reject(
          new Error(`Migration does not support symbolic links: ${relative}`)
        )
      }
      if (stat.kind === 'directory') {
        await visit(absolute)
      } else {
        if (files.size >= MAX_FILES || bytes + stat.size > MAX_BYTES) {
          return Promise.reject(
            new Error(
              'Migration supports up to 256 files and 8 MiB per project.'
            )
          )
        }
        const contents = new Uint8Array(await io.readFile(absolute))
        bytes += contents.byteLength
        if (bytes > MAX_BYTES) {
          return Promise.reject(
            new Error('Migration supports up to 8 MiB per project.')
          )
        }
        files.set(relative, contents)
      }
    }
  }
  await visit(root)
  return files
}

export function withEditorBuffers(
  files: ProjectFiles,
  buffers: ReadonlyMap<string, string>
): ProjectFiles | Error {
  const result = new Map(files)
  for (const [path, code] of buffers) {
    if (!result.has(path))
      return new Error(`Open file ${path} is no longer in the project.`)
    result.set(path, new TextEncoder().encode(code))
  }
  if (
    [...result.values()].reduce((size, file) => size + file.byteLength, 0) >
    MAX_BYTES
  ) {
    return new Error(
      'Migration supports up to 8 MiB per project, including unsaved edits.'
    )
  }
  return result
}

export function candidateFiles(
  original: ProjectFiles,
  incoming: Record<string, number[]>
): ProjectFiles | Error {
  const candidate: ProjectFiles = new Map()
  if (Object.keys(incoming).length !== original.size) {
    return new Error(
      'The migration changed the project file set. No changes were applied.'
    )
  }
  for (const [path, data] of Object.entries(incoming)) {
    const before = original.get(path)
    if (!before || !validProjectPath(path))
      return new Error(`Unexpected migration file: ${path}`)
    const after = new Uint8Array(data)
    if (!path.endsWith('.kcl') && !equalBytes(before, after)) {
      return new Error(`The migration changed a supporting file: ${path}`)
    }
    if (path.endsWith('.kcl')) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(after)
      } catch {
        return new Error(`The migration returned invalid text for ${path}.`)
      }
    }
    candidate.set(path, after)
  }
  return candidate
}
