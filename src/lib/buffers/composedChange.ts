import type { ChangeSet, Text } from '@codemirror/state'
import type { BufferChange } from '@src/contracts/buffers'

/**
 * A published change as one `ChangeSet`, plus the document it applied to.
 *
 * `BufferChange` carries the transactions rather than a change set, because one
 * `dispatch` may build several and the buffer publishes them together. Anything
 * doing change algebra wants the batch as a single set instead, and wants the
 * document it started from — which is `startState.doc` of the first transaction,
 * free to hold because CodeMirror's `Text` is persistent.
 *
 * Composing rather than taking the last one matters: two transactions in a batch
 * are sequential, so the second's offsets are against the document the first
 * produced. Reading only one of them would describe a change nobody made.
 *
 * Null when there is nothing to say — no document change, or a batch whose
 * changes cancel out. Callers can then skip without a special case.
 */
export function composedChange(
  change: BufferChange
): { changes: ChangeSet; docBefore: Text } | null {
  if (!change.docChanged) return null

  const transactions = change.transactions
  const first = transactions[0]
  if (first === undefined) return null

  let changes = first.changes
  for (let at = 1; at < transactions.length; at += 1) {
    changes = changes.compose(transactions[at].changes)
  }

  if (changes.empty) return null
  return { changes, docBefore: first.startState.doc }
}
