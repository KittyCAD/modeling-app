import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import { composedChange } from '@src/lib/buffers/composedChange'
import type { AppliedChange } from '@src/lib/collab/revert'

export interface ChangeHistory {
  /**
   * Record everything that happens to a buffer at a path.
   *
   * Returns a disposer. Following the same path twice replaces the previous
   * subscription rather than doubling up, since a doubled entry is the one bug
   * that makes a revert confidently wrong.
   */
  follow(path: string, buffer: FileBackedTextBuffer): () => void
  /** In application order, ready for `inverseForContribution`. */
  entries(path: string): readonly AppliedChange[]
  forget(path: string): void
  dispose(): void
}

/**
 * What has been applied to each file, and by whom.
 *
 * `inverseForContribution` needs this and cannot reconstruct it: undoing one
 * writer's work means projecting its inverse through *everything* that happened
 * afterwards, so the log has to hold every change, not only the ones being
 * undone. That is why this observes the buffer rather than being fed by whoever
 * applies remote edits — the user's typing has to be in here too, and only the
 * buffer sees all of it.
 *
 * It is also why this is the **single** source of applied history. An earlier
 * version had `applyChanges` return its own entries for the caller to append,
 * which was redundant the moment this existed and actively dangerous: two
 * sources appending to one log double every remote entry, and a doubled entry
 * makes a revert remove text twice over. There is one recorder now.
 *
 * **Session-lifetime only.** It holds CodeMirror `Text` values, which are cheap
 * to keep but do not survive a reload, so exact revert is a session-lifetime
 * capability. Durable revert is a different, weaker mechanism — see the design
 * note in `revert.ts`.
 */
export function createChangeHistory(): ChangeHistory {
  const logs = new Map<string, AppliedChange[]>()
  const disposers = new Map<string, () => void>()

  const stop = (path: string) => {
    disposers.get(path)?.()
    disposers.delete(path)
  }

  return {
    follow(path, buffer) {
      // Replacing rather than adding: two subscriptions on one path would record
      // every change twice, which is invisible until a revert overshoots.
      stop(path)

      const log = logs.get(path) ?? []
      logs.set(path, log)

      const dispose = buffer.onChange((change) => {
        const composed = composedChange(change)
        if (composed === null) return

        log.push({
          changes: composed.changes,
          docBefore: composed.docBefore,
          contributionId: change.contributionId ?? null,
        })
      })

      disposers.set(path, dispose)
      return () => {
        if (disposers.get(path) === dispose) stop(path)
        else dispose()
      }
    },

    entries(path) {
      return logs.get(path) ?? []
    },

    forget(path) {
      stop(path)
      logs.delete(path)
    },

    dispose() {
      for (const path of [...disposers.keys()]) stop(path)
      logs.clear()
    },
  }
}
