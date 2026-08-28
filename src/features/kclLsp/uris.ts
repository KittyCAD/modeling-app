/**
 * Paths as the language server addresses them.
 *
 * LSP speaks URIs, buffers hold absolute filesystem paths, and the conversion
 * has to be exactly reversible or a response comes back for a file nobody can
 * find.
 *
 * Deliberately narrow: only `file:` URIs, only the encoding a path can actually
 * need. A general URI library would handle authorities, queries and fragments,
 * none of which a path has, and would still leave the interesting question —
 * which paths are the same path — to `normalizePath`.
 */

/** `/a/b c.kcl` → `file:///a/b%20c.kcl` */
export function pathToUri(path: string): string {
  const rooted = path.startsWith('/') ? path : `/${path}`

  const encoded = rooted
    .split('/')
    // Per segment, so the separators survive. `encodeURIComponent` also escapes
    // the characters a shell would care about, which is more than needed but
    // never wrong.
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `file://${encoded}`
}

/** `file:///a/b%20c.kcl` → `/a/b c.kcl`, or null for anything else. */
export function uriToPath(uri: string): string | null {
  if (!uri.startsWith('file://')) return null

  const path = uri.slice('file://'.length)
  try {
    return decodeURIComponent(path)
  } catch {
    // A malformed escape is not a path. Better to fail to find the file than to
    // guess at which one was meant.
    return null
  }
}
