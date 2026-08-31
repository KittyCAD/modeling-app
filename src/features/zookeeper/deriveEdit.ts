import type { MlToolResult, ZookeeperEditPatch } from '@kittycad/lib'
import type { TextEdit } from '@src/contracts/modelingOperations'
import { lineDiffEdits } from '@src/lib/buffers/lineDiffEdits'

/** One file's worth of what the agent wants to change. */
export type ProposedFileChange =
  | { kind: 'modify'; path: string; edits: readonly TextEdit[] }
  | { kind: 'create'; path: string; contents: string }
  | { kind: 'delete'; path: string; previousContents: string }

/**
 * A change the agent described that will not be applied.
 *
 * Refusing is a first-class outcome rather than a thrown error: this runs
 * mid-stream under live-apply, so the other paths in the same batch should still
 * land, and the user needs to be told which one did not.
 */
export type RefusalReason =
  /**
   * The manifest says the agent deleted a file, but the contents it claims to
   * have deleted are not the contents we have. It is describing a different
   * document, so honouring the deletion would destroy something it never read.
   */
  | 'deletedContentsDiffer'
  /**
   * The manifest calls a file modified, but no new contents arrived for it. The
   * manifest's own `diff` field is deliberately never parsed, so there is
   * nothing else to go on.
   */
  | 'noContentForModify'

export interface RefusedChange {
  path: string
  reason: RefusalReason
}

export interface DerivedChanges {
  changes: readonly ProposedFileChange[]
  refused: readonly RefusedChange[]
  /**
   * True when the input could not express a deletion at all.
   *
   * `outputs` is a map of files that *exist*, so a path's absence means either
   * "unchanged" or "deleted" and nothing distinguishes them. Only the manifest
   * carries statuses. `project_updated` has no manifest, so a mid-turn apply can
   * never delete — surface this rather than guessing from an absence.
   */
  deletionsUnknowable: boolean
}

/**
 * Turn whole-file output into per-file changes.
 *
 * The service answers with the resulting state of each file it touched, not with
 * a patch. Recovering positions is what makes the edit rebasable, attributable
 * and undoable at a sensible granularity — see `lineDiffEdits` for why replacing
 * the document instead is wrong in four separate ways.
 *
 * `baseline` is the content the agent last saw, per project-relative path. Under
 * live-apply that is **not** necessarily the content at the start of the turn:
 * once the agent's first output has been applied, the second output describes a
 * document built on the first, so diffing it against the start of the turn would
 * re-apply the first output's changes on top of themselves. Advancing the
 * baseline as each output lands keeps every diff a statement about what the agent
 * changed *since we last heard from it*, which is exactly what wants rebasing
 * over the user's concurrent typing.
 *
 * The manifest is read for `status` only. Its `diff` field is never parsed, so a
 * classification and a content cannot disagree — they answer different questions.
 * That is the whole reason two representations of one edit can coexist here
 * without the drift `main` has.
 */
export function deriveChanges(input: {
  baseline: ReadonlyMap<string, string>
  outputs: Readonly<Record<string, string>>
  manifest?: ZookeeperEditPatch | undefined
}): DerivedChanges {
  const { baseline, outputs, manifest } = input

  const changes: ProposedFileChange[] = []
  const refused: RefusedChange[] = []
  /** Paths the manifest already accounted for, so `outputs` does not redo them. */
  const claimed = new Set<string>()

  for (const file of manifest?.changed_files ?? []) {
    claimed.add(file.path)

    if (file.status === 'deleted') {
      const held = baseline.get(file.path)
      /*
       * An unknown path is already gone as far as we are concerned, so there is
       * nothing to do and nothing to complain about. A path we hold with
       * different contents is the dangerous case.
       */
      if (held === undefined) continue
      if (held !== file.previous_contents) {
        refused.push({ path: file.path, reason: 'deletedContentsDiffer' })
        continue
      }
      changes.push({
        kind: 'delete',
        path: file.path,
        previousContents: file.previous_contents,
      })
      continue
    }

    /*
     * `created` carries its own contents; `modified` does not, because its
     * contents live in `outputs`. Either way the decision between create and
     * modify comes from whether *we* hold the file, not from what the manifest
     * calls it — the agent's copy of the project and ours can disagree, and ours
     * is the one being edited.
     */
    const contents =
      file.status === 'created' ? file.contents : outputs[file.path]

    if (contents === undefined) {
      refused.push({ path: file.path, reason: 'noContentForModify' })
      continue
    }

    const change = changeFor(file.path, baseline.get(file.path), contents)
    if (change !== null) changes.push(change)
  }

  for (const [path, contents] of Object.entries(outputs)) {
    if (claimed.has(path)) continue
    const change = changeFor(path, baseline.get(path), contents)
    if (change !== null) changes.push(change)
  }

  return {
    changes,
    refused,
    deletionsUnknowable: manifest?.changed_files === undefined,
  }
}

/**
 * One path's change, or null when there is nothing to do.
 *
 * Dropping a no-op matters more than it looks. The service reports the resulting
 * state of every file it *considered*, so an unchanged file arrives with every
 * turn; `main` wrote those back regardless, which is where its spurious dirty
 * buffers and redundant executions come from.
 */
function changeFor(
  path: string,
  held: string | undefined,
  contents: string
): ProposedFileChange | null {
  if (held === undefined) return { kind: 'create', path, contents }
  if (held === contents) return null

  const edits = lineDiffEdits(held, contents)
  return edits.length === 0 ? null : { kind: 'modify', path, edits }
}

/**
 * Whether a tool result reports a failure, in which case its `outputs` must not
 * be applied.
 *
 * `error` is authoritative when present. `status_code` is the inference: the
 * generated type documents it only as "the status code of the tool execution",
 * and every other status code in this API is HTTP-shaped, so `>= 400` is read as
 * a failure. **Worth confirming against the live service** — the cost of being
 * wrong in this direction is a refused edit the user can re-ask for, whereas
 * being wrong the other way applies the output of a tool that failed.
 */
export function toolResultFailed(result: MlToolResult): boolean {
  if (result.type === 'mechanical_knowledge_base') return false
  if (result.error !== undefined && result.error !== '') return true
  return result.status_code >= 400
}

/**
 * The whole-file outputs a tool result carries, if it carries any.
 *
 * `mechanical_knowledge_base` answers with prose and has no `outputs` field at
 * all, which is why this is a function rather than a property access — the union
 * does not have the key on every branch.
 */
export function outputsOf(
  result: MlToolResult
): Readonly<Record<string, string>> {
  if (result.type === 'mechanical_knowledge_base') return {}
  return result.outputs ?? {}
}

/**
 * The manifest a tool result carries, if any.
 *
 * Only `edit_kcl_code` has one, and even there it is optional — so a
 * `text_to_cad` turn can never express a deletion. That is a protocol fact worth
 * naming in one place rather than rediscovering at each call site.
 */
export function manifestOf(
  result: MlToolResult
): ZookeeperEditPatch | undefined {
  return result.type === 'edit_kcl_code'
    ? result.zookeeper_edit_patch
    : undefined
}
