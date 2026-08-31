import { history, undo, undoDepth } from '@codemirror/commands'
import { ChangeSet } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  type EditorCapability,
  type FileBackedTextBuffer,
  combineCapabilities,
} from '@src/contracts/buffers'
import {
  type ApplyTarget,
  applyChanges,
} from '@src/features/zookeeper/applyChanges'
import { deriveChanges } from '@src/features/zookeeper/deriveEdit'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { createDivergenceLedger } from '@src/lib/collab/divergence'
import { inverseForContribution } from '@src/lib/collab/revert'

const historyCapability: EditorCapability = {
  id: 'history',
  extension: () => history(),
}

const AUTHOR = 'zookeeper:conversation-1'
const CONTRIBUTION = 'turn-1'
const PATH = 'main.kcl'

const bufferWith = (contents: string, path = PATH) =>
  createFileBackedTextBuffer({
    path,
    contents,
    languageId: 'kcl',
    capabilities: combineCapabilities([historyCapability]),
  })

/** A session stand-in holding a fixed set of open buffers. */
const targetOf = (
  buffers: Record<string, FileBackedTextBuffer>,
  executing: string | null = null
): ApplyTarget => ({
  bufferForPath: (path) => buffers[path],
  executingBufferId: () => executing,
})

const textOf = (buffer: FileBackedTextBuffer) =>
  buffer.state.peek().doc.toString()

describe('applyChanges', () => {
  it('applies a modification to the open buffer', () => {
    const buffer = bufferWith('width = 10\n')
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, 'width = 10\n'.length)

    const derived = deriveChanges({
      baseline: new Map([[PATH, 'width = 10\n']]),
      outputs: { [PATH]: 'width = 24\n' },
    })

    const outcome = applyChanges({
      changes: derived.changes,
      baseline: new Map([[PATH, 'width = 10\n']]),
      target: targetOf({ [PATH]: buffer }),
      ledger,
      author: AUTHOR,
      contributionId: CONTRIBUTION,
    })

    expect(outcome.applied).toEqual([PATH])
    expect(outcome.conflicts).toEqual([])
    expect(textOf(buffer)).toBe('width = 24\n')
  })

  it('attributes the transaction it dispatches', () => {
    const buffer = bufferWith('width = 10\n')
    const seen: { origin: string; author?: string; contributionId?: string }[] =
      []
    buffer.onChange((change) =>
      seen.push({
        origin: change.origin,
        author: change.author,
        contributionId: change.contributionId,
      })
    )

    const ledger = createDivergenceLedger()
    ledger.begin(PATH, 'width = 10\n'.length)

    applyChanges({
      changes: [
        {
          kind: 'modify',
          path: PATH,
          edits: [{ from: 0, to: 5, insert: 'depth' }],
        },
      ],
      baseline: new Map([[PATH, 'width = 10\n']]),
      target: targetOf({ [PATH]: buffer }),
      ledger,
      author: AUTHOR,
      contributionId: CONTRIBUTION,
    })

    expect(seen).toEqual([
      { origin: 'semantic', author: AUTHOR, contributionId: CONTRIBUTION },
    ])
  })

  /**
   * The reason `isolateHistory` is not optional. The agent writes while the user
   * is typing, so without its own undo group one Ctrl-Z would step past both the
   * user's keystroke and the agent's edit together.
   */
  it('leaves the edit as its own undo step, separate from recent typing', () => {
    const buffer = bufferWith('width = 10\n')

    // The user types, through the same dispatch boundary.
    buffer.dispatch({
      changes: { from: buffer.state.peek().doc.length, insert: '// mine\n' },
      userEvent: 'input',
    })
    const afterTyping = textOf(buffer)

    const ledger = createDivergenceLedger()
    ledger.begin(PATH, afterTyping.length)

    applyChanges({
      changes: [
        {
          kind: 'modify',
          path: PATH,
          edits: [{ from: 0, to: 5, insert: 'depth' }],
        },
      ],
      baseline: new Map([[PATH, afterTyping]]),
      target: targetOf({ [PATH]: buffer }),
      ledger,
      author: AUTHOR,
      contributionId: CONTRIBUTION,
    })

    expect(textOf(buffer)).toBe('depth = 10\n// mine\n')
    expect(undoDepth(buffer.state.peek())).toBeGreaterThan(1)

    // One undo takes back the agent's edit and leaves the user's typing.
    buffer.runCommand(undo)
    expect(textOf(buffer)).toBe(afterTyping)
    expect(textOf(buffer)).toContain('// mine')
  })

  it('rebases around an edit the user made since the writer looked', () => {
    const baseline = 'width = 10\ndepth = 2\n'
    const buffer = bufferWith(baseline)
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, baseline.length)

    // The user prepends a line; the ledger is told, as a real caller would from
    // `buffer.onChange`.
    const typing = ChangeSet.of(
      [{ from: 0, to: 0, insert: '// mine\n' }],
      baseline.length
    )
    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })
    ledger.recordLocal(PATH, typing)

    // The writer, unaware, edits the last line.
    const outcome = applyChanges({
      changes: [
        {
          kind: 'modify',
          path: PATH,
          edits: [{ from: 11, to: 20, insert: 'depth = 7' }],
        },
      ],
      baseline: new Map([[PATH, baseline]]),
      target: targetOf({ [PATH]: buffer }),
      ledger,
      author: AUTHOR,
      contributionId: CONTRIBUTION,
    })

    expect(outcome.applied).toEqual([PATH])
    expect(textOf(buffer)).toBe('// mine\nwidth = 10\ndepth = 7\n')
  })

  /**
   * The user replaced *exactly* the span the writer was going to change, so the
   * text the writer had in mind is gone rather than merely disturbed.
   */
  it('reports the text as erased when the user replaced the same span', () => {
    const baseline = 'width = 10\ndepth = 2\n'
    const buffer = bufferWith(baseline)
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, baseline.length)

    const typing = ChangeSet.of(
      [{ from: 11, to: 20, insert: 'depth = 99' }],
      baseline.length
    )
    buffer.dispatch({ changes: { from: 11, to: 20, insert: 'depth = 99' } })
    ledger.recordLocal(PATH, typing)

    const outcome = applyChanges({
      changes: [
        {
          kind: 'modify',
          path: PATH,
          edits: [{ from: 11, to: 20, insert: 'depth = 7' }],
        },
      ],
      baseline: new Map([[PATH, baseline]]),
      target: targetOf({ [PATH]: buffer }),
      ledger,
      author: AUTHOR,
      contributionId: CONTRIBUTION,
    })

    expect(outcome.applied).toEqual([])
    expect(outcome.conflicts).toHaveLength(1)
    expect(outcome.conflicts[0]).toMatchObject({ path: PATH, reason: 'erased' })
    // Nothing was written, so the user's version stands.
    expect(textOf(buffer)).toContain('depth = 99')
  })

  it('reports an overlap when the user typed inside the span', () => {
    const baseline = 'width = 10\ndepth = 2\n'
    const buffer = bufferWith(baseline)
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, baseline.length)

    // Typing strictly inside the writer's range, not replacing all of it.
    const typing = ChangeSet.of(
      [{ from: 14, to: 14, insert: 'DEPTH' }],
      baseline.length
    )
    buffer.dispatch({ changes: { from: 14, insert: 'DEPTH' } })
    ledger.recordLocal(PATH, typing)

    const outcome = applyChanges({
      changes: [
        {
          kind: 'modify',
          path: PATH,
          edits: [{ from: 11, to: 20, insert: 'depth = 7' }],
        },
      ],
      baseline: new Map([[PATH, baseline]]),
      target: targetOf({ [PATH]: buffer }),
      ledger,
      author: AUTHOR,
      contributionId: CONTRIBUTION,
    })

    expect(outcome.conflicts[0]).toMatchObject({
      path: PATH,
      reason: 'overlapping',
    })
    expect(textOf(buffer)).toContain('DEPTH')
  })

  it('defers a create or delete to the mutation path', () => {
    const buffer = bufferWith('width = 10\n')
    const ledger = createDivergenceLedger()

    const outcome = applyChanges({
      changes: [
        { kind: 'create', path: 'new.kcl', contents: 'depth = 2\n' },
        { kind: 'delete', path: 'gone.kcl', previousContents: 'x = 1\n' },
      ],
      baseline: new Map([[PATH, 'width = 10\n']]),
      target: targetOf({ [PATH]: buffer }),
      ledger,
      author: AUTHOR,
      contributionId: CONTRIBUTION,
    })

    expect(outcome.applied).toEqual([])
    expect(outcome.deferred).toEqual([
      { path: 'new.kcl', reason: 'needsMutation' },
      { path: 'gone.kcl', reason: 'needsMutation' },
    ])
  })

  /**
   * Not resolved by opening the file here: `openFile` is async, and an await
   * between rebasing and dispatching is exactly the window in which the document
   * can move out from under a rebase already computed.
   */
  it('defers a path with no open buffer rather than opening one', () => {
    const ledger = createDivergenceLedger()

    const outcome = applyChanges({
      changes: [
        {
          kind: 'modify',
          path: 'other.kcl',
          edits: [{ from: 0, to: 1, insert: 'x' }],
        },
      ],
      baseline: new Map([['other.kcl', 'y\n']]),
      target: targetOf({}),
      ledger,
      author: AUTHOR,
      contributionId: CONTRIBUTION,
    })

    expect(outcome.deferred).toEqual([
      { path: 'other.kcl', reason: 'noBuffer' },
    ])
  })

  /**
   * The execution adapter schedules a run off the executing buffer's change, so
   * if that lands first the run reads imports that have not arrived yet.
   */
  it('applies the executing buffer last', () => {
    const main = bufferWith('import "part.kcl"\n', 'main.kcl')
    const part = bufferWith('width = 10\n', 'part.kcl')

    const order: string[] = []
    main.onChange(() => order.push('main.kcl'))
    part.onChange(() => order.push('part.kcl'))

    const ledger = createDivergenceLedger()
    ledger.begin('main.kcl', 'import "part.kcl"\n'.length)
    ledger.begin('part.kcl', 'width = 10\n'.length)

    applyChanges({
      changes: [
        {
          kind: 'modify',
          path: 'main.kcl',
          edits: [{ from: 0, to: 6, insert: 'import' }],
        },
        {
          kind: 'modify',
          path: 'part.kcl',
          edits: [{ from: 0, to: 5, insert: 'depth' }],
        },
      ],
      baseline: new Map([
        ['main.kcl', 'import "part.kcl"\n'],
        ['part.kcl', 'width = 10\n'],
      ]),
      target: targetOf({ 'main.kcl': main, 'part.kcl': part }, main.id),
      ledger,
      author: AUTHOR,
      contributionId: CONTRIBUTION,
    })

    expect(order).toEqual(['part.kcl', 'main.kcl'])
  })

  /**
   * The end of the loop: what was applied can be undone as one contribution,
   * even across two files, without touching what the user did in between.
   */
  it('produces history that reverts the whole contribution', () => {
    const buffer = bufferWith('width = 10\n')
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, 'width = 10\n'.length)

    const outcome = applyChanges({
      changes: [
        {
          kind: 'modify',
          path: PATH,
          edits: [
            {
              from: 'width = 10\n'.length,
              to: 'width = 10\n'.length,
              insert: 'depth = 2\n',
            },
          ],
        },
      ],
      baseline: new Map([[PATH, 'width = 10\n']]),
      target: targetOf({ [PATH]: buffer }),
      ledger,
      author: AUTHOR,
      contributionId: CONTRIBUTION,
    })

    expect(textOf(buffer)).toBe('width = 10\ndepth = 2\n')

    // The user then types, after the writer's edit.
    const applied = [...outcome.history]
    const docBefore = buffer.state.peek().doc
    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })
    applied.push({
      changes: ChangeSet.of(
        [{ from: 0, to: 0, insert: '// mine\n' }],
        docBefore.length
      ),
      docBefore,
      contributionId: null,
    })

    const inverse = inverseForContribution({
      applied,
      contributionId: CONTRIBUTION,
    })
    expect(inverse.changes).not.toBeNull()
    if (inverse.changes === null) return

    buffer.dispatch({ changes: inverse.changes })
    expect(textOf(buffer)).toBe('// mine\nwidth = 10\n')
  })
})
