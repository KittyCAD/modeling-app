import { isolateHistory } from '@codemirror/commands'
import { ChangeSet } from '@codemirror/state'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import type { TextEdit } from '@src/contracts/modelingOperations'
import type { ProposedFileChange } from '@src/features/zookeeper/deriveEdit'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import type { WriteClaims } from '@src/lib/collab/claims'
import type { DivergenceLedger } from '@src/lib/collab/divergence'
import { type ConflictReason, rebaseEdits } from '@src/lib/collab/rebase'

/**
 * The bit of the session this needs.
 *
 * Narrower than `ProjectSession` on purpose: applying an edit needs to find open
 * buffers and know which one executes, and nothing else. Taking the whole session
 * would make this untestable without a registry, and would invite it to grow
 * responsibilities that belong to `applyMutation`.
 */
export interface ApplyTarget {
  /** The open buffer for a project-relative path, if there is one. */
  bufferForPath(path: string): FileBackedTextBuffer | undefined
  /** Which buffer the engine is running, if any. */
  executingBufferId(): string | null
}

export interface PathConflict {
  path: string
  reason: ConflictReason
  /** In the writer's coordinates, so a conflict UI can offer its version. */
  edits: readonly TextEdit[]
}

export type DeferralReason =
  /** Creating or deleting a file spans the filesystem; `applyMutation` owns it. */
  | 'needsMutation'
  /**
   * No buffer is open for the path.
   *
   * Deliberately not resolved by opening one: `openFile` is async, and an `await`
   * between rebasing and dispatching is exactly the window in which the document
   * can move out from under a rebase that has already been computed. The caller
   * opens what it needs first, then applies.
   */
  | 'noBuffer'
  /** The path was never in the baseline, so there is nothing to rebase against. */
  | 'noBaseline'

/** A change that could not be attempted here, and why. */
export interface DeferredChange {
  path: string
  reason: DeferralReason
}

export interface ApplyOutcome {
  applied: readonly string[]
  conflicts: readonly PathConflict[]
  deferred: readonly DeferredChange[]
  /**
   * Paths another writer is mid-turn on, so nothing was written to them.
   *
   * Distinct from a conflict, which says the change cannot be applied at all, and
   * from a deferral, which asks the caller to do something else first. This says
   * *not yet*: the same change may well apply once the claim frees, rebased
   * against whatever the other writer did in the meantime.
   */
  waiting: readonly string[]
}

/**
 * Apply a remote writer's changes to the open buffers, attributed.
 *
 * The one thing to understand about the shape: **there is no `await` between
 * rebasing a path and dispatching it.** `dispatch` is synchronous, so a rebase
 * computed immediately before it cannot go stale — and every case that would
 * need an await (opening a file, creating one, deleting one) is deferred to the
 * caller instead of handled here. That is the whole atomicity argument, and it is
 * why this function is not async.
 *
 * Each path lands as one transaction, which is one undo entry. A contribution
 * spanning several messages therefore lands as several undo entries rather than
 * one; that is a real limitation of applying as you stream, and the answer to it
 * is `inverseForContribution`, not a bigger transaction.
 */
export function applyChanges(input: {
  changes: readonly ProposedFileChange[]
  /** What the writer last saw, per path — the same map `deriveChanges` used. */
  baseline: ReadonlyMap<string, string>
  target: ApplyTarget
  ledger: DivergenceLedger
  /** Opaque collaborator id, recorded on every transaction. */
  author: string
  /** What these changes should be undone along with. */
  contributionId: string
  /**
   * Who may write to which file, when more than one writer is live.
   *
   * Optional so a single-writer caller needs no ceremony, but **required for
   * correctness once two conversations can run at once** — see
   * `src/lib/collab/claims.ts` for the case that makes it so.
   */
  claims?: WriteClaims
}): ApplyOutcome {
  const { changes, baseline, target, ledger, author, contributionId, claims } =
    input

  const applied: string[] = []
  const conflicts: PathConflict[] = []
  const deferred: DeferredChange[] = []
  const waiting: string[] = []

  for (const change of ordered(changes, target)) {
    if (change.kind !== 'modify') {
      deferred.push({ path: change.path, reason: 'needsMutation' })
      continue
    }

    const buffer = target.bufferForPath(change.path)
    if (buffer === undefined) {
      deferred.push({ path: change.path, reason: 'noBuffer' })
      continue
    }

    const held = baseline.get(change.path)
    if (held === undefined) {
      deferred.push({ path: change.path, reason: 'noBaseline' })
      continue
    }

    /*
     * Claimed here rather than up front, for the same reason the rebase happens
     * here: there is no await between taking the claim and writing, so nothing
     * can slip in between. Claiming every path before applying any would also
     * mean a batch that conflicts on one path holds the others hostage.
     */
    if (claims !== undefined && !claims.claim(change.path, author)) {
      waiting.push(change.path)
      continue
    }

    const outcome = rebaseEdits({
      edits: change.edits,
      baselineLength: held.length,
      local: ledger.divergence(change.path),
    })

    if (outcome.kind === 'conflict') {
      conflicts.push({
        path: change.path,
        reason: outcome.reason,
        edits: outcome.edits,
      })
      continue
    }

    buffer.dispatch({
      changes: outcome.edits.map(({ from, to, insert }) => ({
        from,
        to,
        insert,
      })),
      annotations: [
        /*
         * `semantic` is the existing role for a single-file meaning-bearing
         * edit — its docstring already names "a formatting, a modelling action,
         * an agent". The identity is what is new, and it rides beside the role.
         */
        bufferOrigin.of({ role: 'semantic', author, contributionId }),
        /*
         * Its own undo group. Without this, history merges the edit with
         * whatever the user typed moments earlier — recent changes group by
         * time — and one Ctrl-Z would step past both, which is precisely the
         * confusion an attributed edit stream must not create.
         */
        isolateHistory.of('full'),
      ],
      /*
       * No `selection` and no `requestFocus`. Moving the caret and taking the
       * keyboard while somebody is typing is the collaborator equivalent of
       * grabbing their mouse; "jump to what changed" is a gesture they make.
       */
    })

    /*
     * The ledger is told about the **pre-rebase** edit, in the writer's
     * coordinates, because the divergence is measured from the writer's document
     * and that is what moved. Passing the dispatched edit here is the mistake
     * that makes every later rebase for this path measure against a document
     * nobody has.
     */
    ledger.recordRemote(
      change.path,
      ChangeSet.of([...change.edits], held.length)
    )

    applied.push(change.path)
  }

  return { applied, conflicts, deferred, waiting }
}

/**
 * The executing buffer last.
 *
 * The execution adapter schedules a run off the executing buffer's change, so if
 * that lands first the run reads imports that have not arrived yet. Everything
 * else keeps its given order.
 */
function ordered(
  changes: readonly ProposedFileChange[],
  target: ApplyTarget
): readonly ProposedFileChange[] {
  const executingId = target.executingBufferId()
  if (executingId === null) return changes

  const isExecuting = (change: ProposedFileChange) =>
    target.bufferForPath(change.path)?.id === executingId

  const rest = changes.filter((change) => !isExecuting(change))
  const last = changes.filter(isExecuting)
  return last.length === 0 ? changes : [...rest, ...last]
}
