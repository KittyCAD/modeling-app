/**
 * Path helpers.
 *
 * Everything above the filesystem layer speaks forward slashes, including on
 * Windows. Normalising at the boundary rather than per call site means a path
 * used as a map key or compared for containment behaves the same everywhere.
 */

/** Collapse separators, resolve `.` and `..`, and drop a trailing slash. */
export function normalizePath(path: string): string {
  const isAbsolute = path.startsWith('/')
  // A Windows drive prefix survives as-is; only the separators change.
  const driveMatch = /^([a-zA-Z]:)/.exec(path)
  const drive = driveMatch?.[1] ?? ''

  const segments = path
    .slice(drive.length)
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')

  const resolved: string[] = []
  for (const segment of segments) {
    if (segment === '..') {
      // Popping past the root is meaningless, so it is simply ignored.
      if (resolved.length > 0 && resolved.at(-1) !== '..') resolved.pop()
      else if (!isAbsolute && !drive) resolved.push('..')
      continue
    }
    resolved.push(segment)
  }

  const joined = resolved.join('/')
  if (drive) return `${drive}/${joined}`
  return isAbsolute ? `/${joined}` : joined
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter((part) => part.length > 0).join('/'))
}

export function dirname(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('/')
  if (index < 0) return ''
  if (index === 0) return '/'
  return normalized.slice(0, index)
}

export function basename(path: string): string {
  const normalized = normalizePath(path)
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

export function extname(path: string): string {
  const name = basename(path)
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index)
}

/**
 * True when `candidate` is `root` or sits beneath it.
 *
 * Used to decide which library owns a project folder, so overlapping library
 * paths resolve predictably instead of by declaration order.
 */
export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = normalizePath(root)
  const normalizedCandidate = normalizePath(candidate)
  if (!normalizedRoot) return false
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`)
  )
}

/** `candidate` expressed relative to `root`, or null when it is not inside. */
export function relativePath(root: string, candidate: string): string | null {
  if (!isPathInside(root, candidate)) return null
  const normalizedRoot = normalizePath(root)
  const normalizedCandidate = normalizePath(candidate)
  if (normalizedCandidate === normalizedRoot) return ''
  return normalizedCandidate.slice(normalizedRoot.length + 1)
}

/**
 * A filesystem-safe folder name derived from a human title.
 *
 * Titles are free text and folder names are not, so this is the one place that
 * translation happens.
 */
export function toDirectoryName(title: string, fallback = 'untitled'): string {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, '-')
    .replaceAll(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')

  return cleaned.length > 0 ? cleaned.slice(0, 64) : fallback
}

/** `name`, `name-2`, `name-3`… until one is not taken. */
export function uniqueName(requested: string, taken: Iterable<string>): string {
  const existing = new Set(taken)
  if (!existing.has(requested)) return requested

  let suffix = 2
  while (existing.has(`${requested}-${suffix}`)) suffix += 1
  return `${requested}-${suffix}`
}
