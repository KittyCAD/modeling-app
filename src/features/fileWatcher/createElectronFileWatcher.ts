import type { FileChange, FileWatcher } from '@src/contracts/fileWatcher'
import type { DesktopBridge } from '@src/desktop/preload'
import { normalizePath } from '@src/lib/paths'

type Listener = (changes: readonly FileChange[]) => void

interface RootWatch {
  listeners: Set<Listener>
  /** Resolves with the main-process subscription id. */
  subscription: Promise<number>
  /** Set once, so a root is never released twice. */
  released: boolean
}

/**
 * The desktop watcher.
 *
 * One operating-system watch per directory however many features ask for it:
 * the project session wants to reconcile buffers and the settings service wants
 * to notice `project.toml`, and both should be able to say so without knowing
 * about each other or arranging to share a subscription.
 *
 * Coalescing already happened in the main process, which is where the raw events
 * are and where the file can be statted to decide what actually changed.
 */
export function createElectronFileWatcher(
  bridge: DesktopBridge
): FileWatcher & {
  dispose: () => void
} {
  const roots = new Map<string, RootWatch>()
  /** Subscription id -> root, so an incoming batch can find its listeners. */
  const routes = new Map<number, string>()

  const releaseBridge = bridge.onFileChanges(({ subscriptionId, changes }) => {
    const root = routes.get(subscriptionId)
    if (!root) return
    const watch = roots.get(root)
    if (!watch || changes.length === 0) return

    // A copy, so a listener that unwatches on its first batch does not mutate
    // the set being iterated.
    for (const listener of [...watch.listeners]) {
      try {
        listener(changes)
      } catch (error) {
        console.error('fileWatcher: a listener threw', error)
      }
    }
  })

  /** Hand a subscription back, exactly once. */
  const release = (root: string, watch: RootWatch) => {
    if (watch.released) return
    watch.released = true
    if (roots.get(root) === watch) roots.delete(root)

    void watch.subscription
      .then((id) => {
        routes.delete(id)
        return bridge.unwatchDirectory(id)
      })
      .catch(() => {
        // Never started, or already gone. Either way there is nothing left to
        // release.
      })
  }

  return {
    id: 'electron',

    watch(path, listener) {
      const root = normalizePath(path)
      let watch = roots.get(root)

      if (!watch) {
        const claimed: RootWatch = {
          listeners: new Set(),
          subscription: bridge.watchDirectory(root),
          released: false,
        }
        watch = claimed
        roots.set(root, claimed)

        void claimed.subscription
          .then((id) => {
            // A root released before the round trip finished must not start
            // delivering. `release` is already chained onto this same promise
            // and will hand the subscription back.
            if (!claimed.released) routes.set(id, root)
          })
          .catch((error) => {
            console.warn(`fileWatcher: could not watch ${root}`, error)
            if (roots.get(root) === claimed) roots.delete(root)
          })
      }

      const claimed = watch
      claimed.listeners.add(listener)

      return () => {
        claimed.listeners.delete(listener)
        // The last one out turns the watch off. Until then another feature is
        // still listening to the same folder.
        if (claimed.listeners.size === 0) release(root, claimed)
      }
    },

    dispose: () => {
      releaseBridge()
      for (const [root, watch] of [...roots]) release(root, watch)
    },
  }
}
