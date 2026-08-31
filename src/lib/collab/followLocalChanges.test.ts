import { ChangeSet, Text } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'
import {
  type EditorCapability,
  type FileBackedTextBuffer,
  combineCapabilities,
} from '@src/contracts/buffers'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { createDivergenceLedger } from '@src/lib/collab/divergence'
import { followLocalChanges } from '@src/lib/collab/followLocalChanges'
import { rebaseEdits } from '@src/lib/collab/rebase'

const noCapabilities: EditorCapability[] = []

const PATH = 'main.kcl'
const WRITER = 'zookeeper:conversation-1'
const OTHER = 'zookeeper:conversation-2'

const bufferWith = (contents: string) =>
  createFileBackedTextBuffer({
    path: PATH,
    contents,
    languageId: 'kcl',
    capabilities: combineCapabilities(noCapabilities),
  })

const textOf = (buffer: FileBackedTextBuffer) =>
  buffer.state.peek().doc.toString()

/** Dispatch as somebody, the way `applyChanges` would. */
const dispatchAs = (
  buffer: FileBackedTextBuffer,
  author: string | undefined,
  spec: { from: number; to?: number; insert: string }
) => {
  buffer.dispatch({
    changes: spec,
    annotations: bufferOrigin.of(
      author === undefined
        ? { role: 'user' }
        : { role: 'semantic', author, contributionId: 'c1' }
    ),
  })
}

describe('followLocalChanges', () => {
  it('folds the user typing into the divergence', () => {
    const baseline = 'width = 10\n'
    const buffer = bufferWith(baseline)
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, baseline.length)

    followLocalChanges({ path: PATH, buffer, ledger, remoteAuthor: WRITER })

    dispatchAs(buffer, undefined, { from: 0, insert: '// mine\n' })

    const drift = ledger.divergence(PATH)
    expect(drift).not.toBeNull()
    if (drift === null) return
    // Applied to the writer's document, it produces ours.
    expect(drift.apply(Text.of(baseline.split('\n'))).toString()).toBe(
      textOf(buffer)
    )
  })

  /**
   * The writer's own edits are accounted for by `recordRemote`, in the writer's
   * coordinates. Folding them in here as well would count them twice, and every
   * later rebase for the path would be off by the whole edit.
   */
  it('ignores the writer its ledger belongs to', () => {
    const baseline = 'width = 10\n'
    const buffer = bufferWith(baseline)
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, baseline.length)

    followLocalChanges({ path: PATH, buffer, ledger, remoteAuthor: WRITER })

    dispatchAs(buffer, WRITER, { from: 0, insert: 'depth = 2\n' })

    expect(ledger.divergence(PATH)).toBeNull()
  })

  /**
   * The case that only exists because more than one conversation is possible.
   * From writer A's point of view, writer B's edit is indistinguishable from the
   * user's typing: something happened to our document that A does not know about.
   */
  it('folds another writer’s edits in as local', () => {
    const baseline = 'width = 10\n'
    const buffer = bufferWith(baseline)
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, baseline.length)

    followLocalChanges({ path: PATH, buffer, ledger, remoteAuthor: WRITER })

    dispatchAs(buffer, OTHER, { from: 0, insert: '// theirs\n' })

    const drift = ledger.divergence(PATH)
    expect(drift).not.toBeNull()
    if (drift === null) return
    expect(drift.apply(Text.of(baseline.split('\n'))).toString()).toBe(
      textOf(buffer)
    )
  })

  it('folds a reconcile from disk in as local', () => {
    const baseline = 'width = 10\n'
    const buffer = bufferWith(baseline)
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, baseline.length)

    followLocalChanges({ path: PATH, buffer, ledger, remoteAuthor: WRITER })

    // A clean buffer adopts an external change silently; the writer still needs
    // to know its document is no longer ours.
    buffer.reconcile('width = 24\n')

    expect(ledger.divergence(PATH)).not.toBeNull()
  })

  it('ignores a change that moved no text', () => {
    const baseline = 'width = 10\n'
    const buffer = bufferWith(baseline)
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, baseline.length)

    followLocalChanges({ path: PATH, buffer, ledger, remoteAuthor: WRITER })

    buffer.dispatch({ selection: { anchor: 3 } })

    expect(ledger.divergence(PATH)).toBeNull()
  })

  it('stops listening when disposed', () => {
    const baseline = 'width = 10\n'
    const buffer = bufferWith(baseline)
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, baseline.length)

    const dispose = followLocalChanges({
      path: PATH,
      buffer,
      ledger,
      remoteAuthor: WRITER,
    })
    dispose()

    dispatchAs(buffer, undefined, { from: 0, insert: '// mine\n' })

    expect(ledger.divergence(PATH)).toBeNull()
  })

  /**
   * The ledger refuses a change that does not start where the drift ends, which
   * means something moved our document without this subscription seeing it. That
   * has to be reported: a silently under-reporting drift is a rebase writing at
   * positions from a document nobody has.
   */
  it('reports a desync rather than swallowing it', () => {
    const baseline = 'width = 10\n'
    const buffer = bufferWith(baseline)
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, baseline.length)

    // Move the writer's document without touching ours, so the drift now expects
    // a document that is not the one being edited.
    ledger.recordRemote(
      PATH,
      ChangeSet.of([{ from: 0, to: 0, insert: 'xx' }], baseline.length)
    )

    const onDesync = vi.fn()
    followLocalChanges({
      path: PATH,
      buffer,
      ledger,
      remoteAuthor: WRITER,
      onDesync,
    })

    dispatchAs(buffer, undefined, { from: 0, insert: '// mine\n' })

    expect(onDesync).toHaveBeenCalledWith(PATH)
  })

  /**
   * The whole point of the wiring, checked end to end: after a real edit lands
   * and the user types, the *next* rebase for that path is measured correctly —
   * with nobody having called `recordLocal` by hand.
   */
  it('keeps the divergence good enough for the next rebase', () => {
    const baseline = 'width = 10\ndepth = 2\n'
    const buffer = bufferWith(baseline)
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, baseline.length)

    followLocalChanges({ path: PATH, buffer, ledger, remoteAuthor: WRITER })

    // The user prepends a comment. Only the subscription records it.
    dispatchAs(buffer, undefined, { from: 0, insert: '// mine\n' })

    // The writer, still looking at the baseline, rewrites the `depth` line.
    const outcome = rebaseEdits({
      edits: [{ from: 11, to: 20, insert: 'depth = 7' }],
      baselineLength: baseline.length,
      local: ledger.divergence(PATH),
    })

    expect(outcome.kind).toBe('rebased')
    buffer.dispatch({
      changes: outcome.edits.map(({ from, to, insert }) => ({
        from,
        to,
        insert,
      })),
      annotations: bufferOrigin.of({
        role: 'semantic',
        author: WRITER,
        contributionId: 'c1',
      }),
    })

    expect(textOf(buffer)).toBe('// mine\nwidth = 10\ndepth = 7\n')
  })
})
