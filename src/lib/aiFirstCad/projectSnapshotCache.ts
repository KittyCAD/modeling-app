import type { AiProjectKclFile } from '@src/lib/aiFirstCad/projectFiles'
import fsZds from '@src/lib/fs-zds'

const CACHE_DIRECTORY_NAME = 'ai-first-cad-snapshots-v1'

function stableHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function snapshotFileName(projectPath: string, filePath: string) {
  const relativePath = fsZds.relative(projectPath, filePath)
  const readableName = fsZds.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${stableHash(relativePath)}-${readableName}.png`
}

async function snapshotCachePath(projectPath: string, filePath: string) {
  const userDataPath = await fsZds.getPath('userData')
  return fsZds.join(
    userDataPath,
    CACHE_DIRECTORY_NAME,
    stableHash(projectPath),
    snapshotFileName(projectPath, filePath)
  )
}

function pngDataUrlToBytes(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(',')
  if (
    separatorIndex === -1 ||
    !dataUrl.slice(0, separatorIndex).includes(';base64')
  ) {
    return undefined
  }

  try {
    const binary = globalThis.atob(dataUrl.slice(separatorIndex + 1))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return undefined
  }
}

export async function loadProjectSnapshotCache(
  projectPath: string,
  files: AiProjectKclFile[]
) {
  const cachedImages = new Map<string, string>()

  await Promise.all(
    files.map(async (file) => {
      try {
        const cachePath = await snapshotCachePath(projectPath, file.path)
        const [sourceStat, cacheStat] = await Promise.all([
          fsZds.stat(file.path),
          fsZds.stat(cachePath),
        ])
        if (cacheStat.mtimeMs < sourceStat.mtimeMs || cacheStat.size === 0) {
          return
        }

        const imageData = await fsZds.readFile(cachePath)
        if (imageData.length === 0) {
          return
        }
        const imageUrl = URL.createObjectURL(
          new Blob([new Uint8Array(imageData)], { type: 'image/png' })
        )
        cachedImages.set(file.path, imageUrl)
      } catch {
        // Missing or stale previews are expected before the first render.
      }
    })
  )

  return cachedImages
}

export async function writeProjectSnapshotCache(
  projectPath: string,
  filePath: string,
  dataUrl: string
) {
  const imageData = pngDataUrlToBytes(dataUrl)
  if (!imageData || imageData.length === 0) {
    return false
  }

  const cachePath = await snapshotCachePath(projectPath, filePath)
  await fsZds.mkdir(fsZds.dirname(cachePath), { recursive: true })
  await fsZds.writeFile(cachePath, imageData)
  return true
}

export function revokeProjectSnapshotCache(cachedImages: Map<string, string>) {
  for (const imageUrl of cachedImages.values()) {
    URL.revokeObjectURL(imageUrl)
  }
}
