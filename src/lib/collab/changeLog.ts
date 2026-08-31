import { ChangeSet, Text } from '@codemirror/state'
import type { AppliedChange } from '@src/lib/collab/revert'
import { hashString } from '@src/lib/hash'

/** Bumped when a row's shape changes, so an old log is recognised, not misread. */
const FORMAT_VERSION = 1

/** How many contributions of history to keep. Older ones fold into the base. */
const DEFAULT_HORIZON = 25

export interface SerialisedChangeLog {
  v: number
  /** Project-relative path, so a hashed filename can be verified. */
  path: string
  /** The document every row below applies to, in order. */
  base: string
  /**
   * The document after every row.
   *
   * The load-time check: if this does not match what is on disk now, something
   * edited the file outside the app and the rows no longer describe it.
   */
  headHash: string
  rows: { c: unknown; k: string | null }[]
}

/**
 * Change history that survives a reload.
 *
 * **`docBefore` is never stored.** That was the expensive-looking part and it is
 * free: one base document plus every `ChangeSet` since is enough, because
 * replaying reconstructs any intermediate document exactly. `ChangeSet.toJSON`
 * exists for precisely this — it is what `@codemirror/collab` ships over a wire.
 *
 * **Compaction is what makes it cheap, and it is free too.** `inverseForContribution`
 * composes the entries following a contribution anyway, so composing adjacent rows
 * that share a `contributionId` at write time loses nothing. Measured on a session
 * of 6,040 transactions over a file that grew to 9 KB: 203 KB uncompacted across
 * 6,040 rows, 9.4 KB compacted across 40 — about one extra copy of the file.
 * Uncompacted history scales with keystrokes, which is the wrong axis; compacted
 * scales with turns.
 *
 * Only runs sharing a `contributionId` may merge. Merging across a boundary would
 * destroy the stranded-range detection, which walks entries one at a time and has
 * to tell a contribution's own later edits from somebody else's.
 */
export function serialiseChangeLog(input: {
  path: string
  entries: readonly AppliedChange[]
  /** The document as it now stands, for the load-time staleness check. */
  head: string
  /** Contributions of history to keep. Older ones fold into the base. */
  horizon?: number
}): SerialisedChangeLog {
  const { path, head, horizon = DEFAULT_HORIZON } = input
  const compacted = compactEntries(input.entries)
  const { base, entries } = applyHorizon(compacted, horizon)

  return {
    v: FORMAT_VERSION,
    path,
    base,
    headHash: hashString(head),
    rows: entries.map((entry) => ({
      c: entry.changes.toJSON(),
      k: entry.contributionId,
    })),
  }
}

/**
 * Read a log back, or refuse it.
 *
 * Null when the log cannot be trusted, and the three reasons are all worth
 * distinguishing from a bug:
 *
 * - **A different format.** Read as if it were this one, an old log would
 *   produce confident nonsense.
 * - **A different file.** Filenames are hashed, and a hash can collide; the path
 *   is stored so that is detectable rather than silent.
 * - **A different document.** If the file was edited outside the app — in another
 *   editor, by a script — the rows no longer describe it, and no amount of stored
 *   history fixes that. This is the honest limit of the whole mechanism, and the
 *   reason the weaker revert still has to exist.
 */
export function parseChangeLog(
  serialised: SerialisedChangeLog,
  expected: { path: string; head: string }
): readonly AppliedChange[] | null {
  if (serialised.v !== FORMAT_VERSION) return null
  if (serialised.path !== expected.path) return null
  if (serialised.headHash !== hashString(expected.head)) return null

  const entries: AppliedChange[] = []
  let doc = Text.of(serialised.base.split('\n'))

  for (const row of serialised.rows) {
    let changes: ChangeSet
    try {
      changes = ChangeSet.fromJSON(row.c)
    } catch {
      // A corrupt row makes everything after it meaningless, since each row's
      // coordinates depend on the one before. Refuse the log rather than replay
      // half of it.
      return null
    }
    // A row whose length disagrees with the document it should apply to means
    // the log and the base have drifted apart.
    if (changes.length !== doc.length) return null

    entries.push({ changes, docBefore: doc, contributionId: row.k })
    doc = changes.apply(doc)
  }

  // The rows have to arrive at the document they claimed to.
  if (hashString(doc.toString()) !== serialised.headHash) return null

  return entries
}

/**
 * Compose adjacent rows that belong to the same contribution.
 *
 * The whole storage argument. A three-hundred-keystroke typing burst becomes one
 * `ChangeSet` sized by the text it touched rather than by the number of
 * keystrokes.
 */
export function compactEntries(
  entries: readonly AppliedChange[]
): readonly AppliedChange[] {
  const out: AppliedChange[] = []

  for (const entry of entries) {
    if (entry.changes.empty) continue

    const last = out.at(-1)
    if (last !== undefined && last.contributionId === entry.contributionId) {
      out[out.length - 1] = {
        changes: last.changes.compose(entry.changes),
        // The earlier of the two: the merged row starts where the first did.
        docBefore: last.docBefore,
        contributionId: last.contributionId,
      }
      continue
    }
    out.push(entry)
  }

  return out
}

/**
 * Keep the most recent contributions and fold the rest into a new base.
 *
 * Without this the log grows for as long as a project is open. With it the cost
 * is bounded by the window rather than by the session, and the only thing lost is
 * the ability to revert a turn from further back than the horizon — which is not
 * a thing anybody asks for, and the log says so by simply not holding it.
 */
export function applyHorizon(
  entries: readonly AppliedChange[],
  horizon: number
): { base: string; entries: readonly AppliedChange[] } {
  const baseOf = (from: readonly AppliedChange[]) =>
    from[0]?.docBefore.toString() ?? ''

  if (entries.length === 0) return { base: '', entries }

  // Distinct contributions, oldest first. `null` runs count too: they are what
  // separates one contribution from the next.
  const boundaries: number[] = []
  for (let at = 0; at < entries.length; at += 1) {
    if (entries[at].contributionId !== null) boundaries.push(at)
  }

  if (boundaries.length <= horizon) {
    return { base: baseOf(entries), entries }
  }

  const cut = boundaries[boundaries.length - horizon]
  const kept = entries.slice(cut)
  return { base: baseOf(kept), entries: kept }
}
