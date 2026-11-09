import { diff } from '@codemirror/merge'
import { ChangeSet, type Text } from '@codemirror/state'

/** Express a codemod's printed result as separate edits in the original buffer's UTF-16 coordinates. */
export function documentChanges(before: Text, after: string): ChangeSet {
  return ChangeSet.of(
    diff(before.toString(), after).map((change) => ({
      from: change.fromA,
      to: change.toA,
      insert: after.slice(change.fromB, change.toB),
    })),
    before.length
  )
}
