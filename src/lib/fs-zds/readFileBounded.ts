import fs from 'node:fs/promises'

export async function readFileBounded(
  path: string,
  maxBytes: number
): Promise<Uint8Array> {
  if (maxBytes < 0 || !Number.isSafeInteger(maxBytes + 1)) {
    return Promise.reject('EINVAL')
  }

  try {
    if (!(await fs.lstat(path)).isFile()) {
      return Promise.reject('EINVAL')
    }
    // The path can change between lstat and open. Nonblocking open prevents a
    // replacement FIFO from stalling before the handle can be checked.
    const flags =
      fs.constants.O_RDONLY |
      (fs.constants.O_NONBLOCK ?? 0) |
      (fs.constants.O_NOFOLLOW ?? 0)
    const file = await fs.open(path, flags)
    try {
      const stat = await file.stat()
      if (!stat.isFile()) return await Promise.reject('EINVAL')
      if (stat.size > maxBytes) return await Promise.reject('EFBIG')

      // Read one extra byte to detect growth after stat.
      const bytes = new Uint8Array(stat.size + 1)
      let offset = 0
      while (offset < bytes.byteLength) {
        const { bytesRead } = await file.read(
          bytes,
          offset,
          bytes.byteLength - offset,
          offset
        )
        if (bytesRead === 0) return bytes.slice(0, offset)
        offset += bytesRead
      }
      return await Promise.reject(stat.size === maxBytes ? 'EFBIG' : 'EAGAIN')
    } finally {
      await file.close()
    }
  } catch (error) {
    // The Electron context bridge does not preserve Error.code.
    return Promise.reject(
      error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string'
        ? error.code
        : error
    )
  }
}
