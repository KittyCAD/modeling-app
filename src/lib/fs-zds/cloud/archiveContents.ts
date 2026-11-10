import { posix } from '@chainner/node-path'
import JSZip from 'jszip'

export interface ProjectArchiveLimits {
  readonly maxBytes: number
  readonly maxEntries: number
}

export const PROJECT_ARCHIVE_LIMITS: ProjectArchiveLimits = {
  maxBytes: 256 * 1024 * 1024,
  maxEntries: 10_000,
}

function safeArchivePath(path: string) {
  const name = path.endsWith('/') ? path.slice(0, -1) : path
  return (
    name.length > 0 &&
    !name.includes('\\') &&
    !name.includes('\0') &&
    !posix.isAbsolute(name) &&
    !/^[a-z]:/i.test(name) &&
    name !== '.' &&
    name !== '..' &&
    !name.startsWith('../') &&
    posix.normalize(name) === name
  )
}

/** Inspect central-directory records before JSZip allocates entries or inflates any bytes. */
function validateZipDirectory(
  archive: ArrayBuffer,
  limits: ProjectArchiveLimits
) {
  if (archive.byteLength > limits.maxBytes)
    return new Error('Project archive exceeds the size limit.')
  const data = new DataView(archive)
  let end = archive.byteLength - 22
  const first = Math.max(0, end - 65_535)
  for (; end >= first; end--) {
    if (
      data.getUint32(end, true) === 0x06054b50 &&
      end + 22 + data.getUint16(end + 20, true) === archive.byteLength
    )
      break
  }
  if (end < first) return new Error('Project archive is not a valid ZIP file.')
  const count = data.getUint16(end + 10, true)
  if (
    count > limits.maxEntries ||
    data.getUint16(end + 8, true) !== count ||
    data.getUint16(end + 4, true) !== 0 ||
    data.getUint16(end + 6, true) !== 0
  )
    return new Error(
      'Project archive exceeds the supported file count or format.'
    )
  let offset = data.getUint32(end + 16, true)
  const directoryEnd = offset + data.getUint32(end + 12, true)
  if (directoryEnd > end)
    return new Error('Project archive directory is invalid.')
  let entries = 0
  let expandedBytes = 0
  const names = new Set<string>()
  const bytes = new Uint8Array(archive)
  const decoder = new TextDecoder()
  while (offset < directoryEnd) {
    if (
      offset + 46 > directoryEnd ||
      data.getUint32(offset, true) !== 0x02014b50
    )
      return new Error('Project archive directory is invalid.')
    const nameLength = data.getUint16(offset + 28, true)
    const next =
      offset +
      46 +
      nameLength +
      data.getUint16(offset + 30, true) +
      data.getUint16(offset + 32, true)
    if (next > directoryEnd)
      return new Error('Project archive directory is invalid.')
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength)
    )
    if (!safeArchivePath(name) || names.has(name))
      return new Error(
        'Project archive contains an unsafe or duplicate file path.'
      )
    names.add(name)
    entries += 1
    expandedBytes += data.getUint32(offset + 24, true)
    if (entries > limits.maxEntries || expandedBytes > limits.maxBytes)
      return new Error('Project archive exceeds the size or file count limit.')
    offset = next
  }
  return entries === count
    ? undefined
    : new Error('Project archive directory is invalid.')
}

// JSZip exposes internalStream at runtime but omits it from its JSZipObject declarations.
type StreamingZipEntry = JSZip.JSZipObject & {
  internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>
}

function readZipEntry(
  entry: JSZip.JSZipObject,
  maxBytes: number
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const stream = (entry as StreamingZipEntry).internalStream('uint8array')
    const chunks: Uint8Array[] = []
    let size = 0
    let stopped = false
    stream
      .on('data', (chunk) => {
        if (stopped) return
        size += chunk.byteLength
        if (size > maxBytes) {
          stopped = true
          stream.pause()
          chunks.length = 0
          reject(new Error('Project archive exceeds the size limit.'))
          return
        }
        chunks.push(chunk)
      })
      .on('error', reject)
      .on('end', () => {
        if (stopped) return
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        resolve(bytes)
      })
      .resume()
  })
}

export async function readProjectZip(
  archive: ArrayBuffer,
  limits = PROJECT_ARCHIVE_LIMITS
) {
  const error = validateZipDirectory(archive, limits)
  if (error) return Promise.reject(error)
  const zip = await JSZip.loadAsync(archive)
  const files: { relativePath: string; data: Uint8Array<ArrayBuffer> }[] = []
  let remaining = limits.maxBytes
  for (const entry of Object.values(zip.files)) {
    const permissions =
      typeof entry.unixPermissions === 'string'
        ? parseInt(entry.unixPermissions, 8)
        : (entry.unixPermissions ?? 0)
    if (
      !safeArchivePath(entry.unsafeOriginalName ?? entry.name) ||
      !safeArchivePath(entry.name) ||
      (permissions & 0o170000) === 0o120000
    )
      return Promise.reject(
        new Error(
          'Project archive contains an unsafe file path or symbolic link.'
        )
      )
    if (entry.dir || entry.name.startsWith('__MACOSX/')) continue
    const data = await readZipEntry(entry, remaining)
    remaining -= data.byteLength
    files.push({ relativePath: entry.name, data })
  }
  return files
}

export function firstExistingProjectFile(
  paths: ReadonlySet<string>,
  ...candidates: (string | undefined)[]
) {
  return candidates.find(
    (path) => path !== undefined && path !== '' && paths.has(path)
  )
}
