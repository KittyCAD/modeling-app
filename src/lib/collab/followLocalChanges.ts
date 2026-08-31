import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import { composedChange } from '@src/lib/buffers/composedChange'
import type { DivergenceLedger } from '@src/lib/collab/divergence'

/**
 * Keep one writer's divergence up to date from a buffer's change stream.
 *
 * This is the other half of `rebaseEdits`' `local` argument. The ledger holds the
 * drift; this is what tells it about everything that happens on our side, by
 * subscribing to the one dispatch boundary every writer already goes through.
 * Nothing else has to cooperate — typing, a command, an LSP response, a
 * reconcile from disk and another collaborator's edit all arrive here.
 *
 * **The divergence is per writer, not per file.** It measures the distance from
 * *that writer's* document to ours, so a second conversation needs its own
 * ledger and its own subscription. Which is why `remoteAuthor` exists: from
 * writer A's point of view, writer B's edits are indistinguishable from the
 * user's typing — both are things that happened to our document that A does not
 * know about — so they are folded in as local. Only A's *own* edits are skipped,
 * because `applyChanges` has already accounted for those by calling
 * `recordRemote` with the pre-rebase edit, which is the only form that means
 * anything in A's coordinates.
 *
 * Getting that filter wrong is quiet in both directions. Skip too much and the
 * drift under-reports, so a later rebase writes at positions that are off by
 * whatever was missed. Skip too little and the writer's own edit is counted
 * twice, once from `recordRemote` and once from here.
 *
 * Returns a disposer. Buffers outlive panes but not projects, so somebody has to
 * stop listening.
 */
export function followLocalChanges(input: {
  /** Project-relative, matching the key the ledger and the service both use. */
  path: string
  buffer: FileBackedTextBuffer
  ledger: DivergenceLedger
  /** The writer this ledger belongs to. Its own edits are not folded in. */
  remoteAuthor: string
  /**
   * Called when a change could not be folded in, meaning the drift for this path
   * can no longer be trusted.
   *
   * `recordLocal` refuses a change that does not start where the drift ends,
   * which happens when something moved our document without this subscription
   * seeing it. Ignoring that would leave a plausible-looking ledger describing a
   * document nobody has, so it is reported rather than swallowed — the honest
   * response is to recapture the writer's view of the file.
   */
  onDesync?: (path: string) => void
}): () => void {
  const { path, buffer, ledger, remoteAuthor, onDesync } = input

  return buffer.onChange((change) => {
    if (change.author === remoteAuthor) return

    const composed = composedChange(change)
    if (composed === null) return

    if (!ledger.recordLocal(path, composed.changes)) onDesync?.(path)
  })
}
