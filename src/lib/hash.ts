/**
 * A small, stable, non-cryptographic string hash (FNV-1a, 32-bit).
 *
 * Used to derive library ids from their configuration. Stability across runs and
 * across machines is the only requirement: an id has to survive a reload and
 * mean the same thing in a persisted layout or a URL.
 */
export function hashString(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    // The FNV prime, applied with shifts to stay in 32-bit integer range.
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return (hash >>> 0).toString(36)
}
