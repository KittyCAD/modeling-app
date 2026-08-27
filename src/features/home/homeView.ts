import type { ProjectLibrary } from '@src/lib/projectLibraries'

/**
 * What Home is showing.
 *
 * Three states rather than a nullable library id, because "no library chosen"
 * genuinely means two different things:
 *
 * - `auto` is where you land. With one library it shows that library's projects,
 *   because an index of one row is friction with no payoff. With several it
 *   shows the index.
 * - `index` is the user explicitly asking to see and manage their libraries,
 *   which has to be reachable even when there is only one.
 * - `library` is a specific library, chosen or deep-linked.
 *
 * Collapsing `auto` and `index` into one value is what made "Add library"
 * unreachable for anyone with a single library.
 */
export type HomeView =
  | { kind: 'auto' }
  | { kind: 'index' }
  | { kind: 'library'; libraryId: string }

/**
 * The library to render, if any.
 *
 * A `library` view whose library no longer resolves — removed, or a stale URL —
 * falls back to `auto` rather than showing an empty shell.
 */
export function resolveHomeLibrary(
  view: HomeView,
  libraries: readonly ProjectLibrary[]
): ProjectLibrary | undefined {
  if (view.kind === 'index') return undefined

  if (view.kind === 'library') {
    const found = libraries.find((library) => library.id === view.libraryId)
    if (found) return found
  }

  return libraries.length === 1 ? libraries[0] : undefined
}
