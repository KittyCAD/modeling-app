import type { FileSystem } from '@src/contracts/fileSystem'
import { parseProjectTitle } from '@src/features/directoryLibrary/directoryScanner'
import { basename, extname, joinPath, relativePath } from '@src/lib/paths'
import JSZip from 'jszip'

export interface CloudArchiveFile {
  relativePath: string
  data: Uint8Array
}

export interface CloudProjectManifest {
  files: Record<string, { size: number; sha256: string }>
}

const EXCLUDED_PARTS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.jj',
  '.zds-cloud-sync.json',
])

function safeRelativePath(path: string): string | null {
  const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0 || parts.some((part) => part === '..')) return null
  return parts.join('/')
}

/** Read the complete portable payload beneath one local project directory. */
export async function readCloudArchive(
  fileSystem: FileSystem,
  projectPath: string
): Promise<CloudArchiveFile[]> {
  const files: CloudArchiveFile[] = []

  const walk = async (directory: string) => {
    for (const entry of await fileSystem.readDirectory(directory)) {
      if (EXCLUDED_PARTS.has(entry.name)) continue
      const path = joinPath(directory, entry.name)
      if (entry.kind === 'directory') {
        await walk(path)
        continue
      }
      const relative = relativePath(projectPath, path)
      if (!relative) continue
      files.push({
        relativePath: relative,
        data: await fileSystem.readFile(path),
      })
    }
  }

  await walk(projectPath)
  return files.toSorted((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export async function parseCloudArchive(
  archive: ArrayBuffer
): Promise<CloudArchiveFile[]> {
  const zip = await JSZip.loadAsync(archive)
  const entries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !entry.name.startsWith('__MACOSX/')
  )
  const firstParts = entries.map((entry) =>
    entry.name.split('/').filter(Boolean)
  )
  const commonRoot =
    firstParts.length > 0 &&
    firstParts[0].length > 1 &&
    firstParts.every((parts) => parts[0] === firstParts[0][0])
      ? firstParts[0][0]
      : ''

  const files = await Promise.all(
    entries.map(async (entry) => {
      const name = commonRoot
        ? entry.name.replace(new RegExp(`^${escapeRegExp(commonRoot)}/`), '')
        : entry.name
      const relative = safeRelativePath(name)
      return relative
        ? {
            relativePath: relative,
            data: Uint8Array.from(await entry.async('uint8array')),
          }
        : null
    })
  )
  return files.filter((file) => file !== null)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Replace a local materialization without ever writing outside its root. */
export async function writeCloudArchive(
  fileSystem: FileSystem,
  projectPath: string,
  files: readonly CloudArchiveFile[]
): Promise<void> {
  await fileSystem.makeDirectory(projectPath)
  const incoming = new Set(
    files.map((file) => safeRelativePath(file.relativePath))
  )

  if (await fileSystem.exists(projectPath)) {
    for (const local of await readCloudArchive(fileSystem, projectPath)) {
      if (!incoming.has(local.relativePath)) {
        await fileSystem.remove(joinPath(projectPath, local.relativePath))
      }
    }
  }

  for (const file of files) {
    const relative = safeRelativePath(file.relativePath)
    if (!relative) continue
    await fileSystem.writeFile(joinPath(projectPath, relative), file.data)
  }
}

export function projectTitle(
  projectPath: string,
  files: readonly CloudArchiveFile[]
): string {
  const toml = files.find((file) => file.relativePath === 'project.toml')
  return (
    (toml && parseProjectTitle(new TextDecoder().decode(toml.data))) ||
    basename(projectPath) ||
    'Untitled'
  )
}

export function projectEntrypoint(
  files: readonly CloudArchiveFile[],
  preferred?: string
): string {
  const paths = new Set(files.map((file) => file.relativePath))
  if (preferred && paths.has(preferred)) return preferred
  if (paths.has('main.kcl')) return 'main.kcl'
  const kcl = files
    .map((file) => file.relativePath)
    .filter((path) => extname(path).toLowerCase() === '.kcl')
    .toSorted(
      (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)
    )[0]
  if (!kcl)
    throw new Error('Cloud sync needs at least one KCL file in a project.')
  return kcl
}

export async function manifestOf(
  files: readonly CloudArchiveFile[]
): Promise<CloudProjectManifest> {
  const manifest: CloudProjectManifest = { files: {} }
  for (const file of files) {
    manifest.files[file.relativePath] = {
      size: file.data.byteLength,
      sha256: await hashBytes(file.data),
    }
  }
  return manifest
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest(
      'SHA-256',
      toArrayBuffer(bytes)
    )
    return Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')
  }

  // Deterministic fallback for runtimes without Web Crypto. It is not used as
  // a security primitive; it only answers whether bytes changed.
  let hash = 2166136261
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function manifestsEqual(
  left: CloudProjectManifest | undefined,
  right: CloudProjectManifest | undefined
): boolean {
  if (!left || !right) return false
  const leftEntries = Object.entries(left.files).toSorted(([a], [b]) =>
    a.localeCompare(b)
  )
  const rightEntries = Object.entries(right.files).toSorted(([a], [b]) =>
    a.localeCompare(b)
  )
  if (leftEntries.length !== rightEntries.length) return false
  return leftEntries.every(([path, entry], index) => {
    const [otherPath, other] = rightEntries[index]
    return (
      path === otherPath &&
      entry.size === other.size &&
      entry.sha256 === other.sha256
    )
  })
}

export function mimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.kcl':
    case '.toml':
      return 'text/plain'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
