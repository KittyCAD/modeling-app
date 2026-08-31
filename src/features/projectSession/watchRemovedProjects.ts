import { type ReadonlySignal, effect } from '@preact/signals'
import type { LibraryLoadState } from '@src/contracts/projectLibraries'

export interface WatchRemovedProjectsDependencies {
  /** Every project the libraries currently know about, by path. */
  paths: ReadonlySignal<readonly string[]>
  /** Whether that list can be believed yet. */
  state: ReadonlySignal<LibraryLoadState>
  /**
   * Projects this app has had open, by path.
   *
   * Read live rather than captured, and mutated by the caller: a project opened
   * after this starts watching still has to be covered.
   */
  opened: () => Iterable<string>
  announce: (projectPath: string) => void
}

/**
 * Notice when a project this app had open disappears from the libraries.
 *
 * Watching rather than being told, because deletion happens from the home screen
 * with nothing open — the delete call has no idea a session ever existed.
 *
 * Two guards, and both are the difference between a cleanup and a data loss.
 * `ready` only, because a list that is still being scanned is not evidence of
 * absence. And never on an empty list, because `realizations` is transiently
 * empty in the middle of a rescan: announcing then would tell every listener to
 * throw away work for every project it has, a moment before they all come back.
 *
 * Extracted so those two conditions can be tested directly. They are the sort of
 * thing that looks obviously right and fires at the wrong moment.
 */
export function watchRemovedProjects(
  dependencies: WatchRemovedProjectsDependencies
): () => void {
  const { paths, state, opened, announce } = dependencies

  return effect(() => {
    if (state.value !== 'ready') return

    const present = paths.value
    if (present.length === 0) return

    const known = new Set(present)
    // Copied before iterating: `announce` is expected to drop the path from
    // whatever `opened` reads, and mutating a live iterable is how that becomes
    // an intermittent bug.
    for (const path of [...opened()]) {
      if (!known.has(path)) announce(path)
    }
  })
}
