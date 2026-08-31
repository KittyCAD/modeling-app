import { ChangeSet, Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import type { TextEdit } from '@src/contracts/modelingOperations'
import { deriveChanges } from '@src/features/zookeeper/deriveEdit'
import { createDivergenceLedger } from '@src/lib/collab/divergence'
import { rebaseEdits } from '@src/lib/collab/rebase'

const PATH = 'main.kcl'

const docOf = (text: string) => Text.of(text.split('\n'))

const applyChanges = (text: string, changes: ChangeSet) =>
  changes.apply(docOf(text)).toString()

const setOf = (edits: readonly TextEdit[], length: number) =>
  ChangeSet.of([...edits], length)

describe('createDivergenceLedger', () => {
  it('reports nothing while the two documents agree', () => {
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, 11)

    expect(ledger.tracks(PATH)).toBe(true)
    expect(ledger.divergence(PATH)).toBeNull()
  })

  it('accumulates local changes', () => {
    const baseline = 'width = 10\n'
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, baseline.length)

    const first = ChangeSet.of(
      [{ from: 0, to: 5, insert: 'thickness' }],
      baseline.length
    )
    ledger.recordLocal(PATH, first)
    const ours = applyChanges(baseline, first)

    const second = ChangeSet.of(
      [{ from: ours.length, to: ours.length, insert: '// note\n' }],
      ours.length
    )
    ledger.recordLocal(PATH, second)

    const drift = ledger.divergence(PATH)
    expect(drift).not.toBeNull()
    if (drift === null) return
    expect(applyChanges(baseline, drift)).toBe(applyChanges(ours, second))
  })

  it('forgets a path on request', () => {
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, 11)
    ledger.forget(PATH)

    expect(ledger.tracks(PATH)).toBe(false)
  })

  it('clears every path', () => {
    const ledger = createDivergenceLedger()
    ledger.begin(PATH, 11)
    ledger.begin('other.kcl', 4)
    ledger.clear()

    expect(ledger.tracks(PATH)).toBe(false)
    expect(ledger.tracks('other.kcl')).toBe(false)
  })

  /**
   * The whole design, end to end, on the case `main` cannot handle: a turn that
   * streams two outputs while the user keeps typing.
   *
   * The failure being ruled out is a double-apply. The agent's second output
   * describes a document built on its first, so diffing it against the *start* of
   * the turn would re-apply the first output's work on top of itself. Advancing
   * the baseline as each output lands is what makes each diff a statement about
   * what changed since we last heard from the agent — and the divergence is what
   * carries that statement onto the document the user has actually been editing.
   */
  it('applies a two-output turn around concurrent typing, exactly once', () => {
    const ledger = createDivergenceLedger()

    const baseline = 'width = 10\n'
    ledger.begin(PATH, baseline.length)

    // What the agent last told us. Advances with each output it sends.
    let agentView = baseline
    let ours = baseline

    // The user appends a comment before the agent has said anything.
    const typing = ChangeSet.of(
      [{ from: ours.length, to: ours.length, insert: '// mine\n' }],
      ours.length
    )
    ours = applyChanges(ours, typing)
    expect(ledger.recordLocal(PATH, typing)).toBe(true)
    expect(ours).toBe('width = 10\n// mine\n')

    // First output: the agent adds a line to its own copy of the baseline.
    const firstOutput = 'width = 10\ndepth = 2\n'
    const first = deriveChanges({
      baseline: new Map([[PATH, agentView]]),
      outputs: { [PATH]: firstOutput },
    })
    const firstChange = first.changes[0]
    expect(firstChange).toMatchObject({ kind: 'modify' })
    if (firstChange.kind !== 'modify') return

    const firstRebase = rebaseEdits({
      edits: firstChange.edits,
      baselineLength: agentView.length,
      local: ledger.divergence(PATH),
    })
    expect(firstRebase.kind).toBe('rebased')

    ours = applyChanges(ours, setOf(firstRebase.edits, ours.length))
    expect(
      ledger.recordRemote(PATH, setOf(firstChange.edits, agentView.length))
    ).toBe(true)
    agentView = firstOutput

    // The user's comment survived, and the agent's line landed.
    expect(ours).toContain('// mine')
    expect(ours).toContain('depth = 2')

    // The divergence still describes the trip from the agent's copy to ours.
    const drift = ledger.divergence(PATH)
    expect(drift).not.toBeNull()
    if (drift === null) return
    expect(applyChanges(agentView, drift)).toBe(ours)

    // The user types again, this time at the top of the file.
    const moreTyping = ChangeSet.of(
      [{ from: 0, to: 0, insert: 'x = 1\n' }],
      ours.length
    )
    ours = applyChanges(ours, moreTyping)
    expect(ledger.recordLocal(PATH, moreTyping)).toBe(true)

    // Second output, built on the agent's own first output.
    const secondOutput = 'width = 10\ndepth = 2\nheight = 4\n'
    const second = deriveChanges({
      baseline: new Map([[PATH, agentView]]),
      outputs: { [PATH]: secondOutput },
    })
    const secondChange = second.changes[0]
    expect(secondChange).toMatchObject({ kind: 'modify' })
    if (secondChange.kind !== 'modify') return

    // Because the baseline advanced, this describes only the new line.
    expect(secondChange.edits).toHaveLength(1)
    expect(secondChange.edits[0].insert).toContain('height = 4')

    const secondRebase = rebaseEdits({
      edits: secondChange.edits,
      baselineLength: agentView.length,
      local: ledger.divergence(PATH),
    })
    expect(secondRebase.kind).toBe('rebased')

    ours = applyChanges(ours, setOf(secondRebase.edits, ours.length))
    expect(
      ledger.recordRemote(PATH, setOf(secondChange.edits, agentView.length))
    ).toBe(true)
    agentView = secondOutput

    // Everything from both parties, and `depth = 2` exactly once.
    expect(ours).toBe('x = 1\nwidth = 10\n// mine\ndepth = 2\nheight = 4\n')
    expect(ours.match(/depth = 2/g)).toHaveLength(1)

    const finalDrift = ledger.divergence(PATH)
    expect(finalDrift).not.toBeNull()
    if (finalDrift === null) return
    expect(applyChanges(agentView, finalDrift)).toBe(ours)
  })

  /**
   * The same turn, with the user editing the very text the agent is rewriting.
   * There is no automated answer here, so the edit must be refused rather than
   * merged — and the user's own work must survive untouched.
   */
  it('refuses an output whose text the user has since rewritten', () => {
    const ledger = createDivergenceLedger()
    const baseline = 'width = 10\ndepth = 2\n'
    ledger.begin(PATH, baseline.length)

    // The user rewrites the `depth` line.
    const typing = ChangeSet.of(
      [{ from: 11, to: 20, insert: 'depth = 99' }],
      baseline.length
    )
    const ours = applyChanges(baseline, typing)
    ledger.recordLocal(PATH, typing)

    // The agent, unaware, rewrites the same line.
    const derived = deriveChanges({
      baseline: new Map([[PATH, baseline]]),
      outputs: { [PATH]: 'width = 10\ndepth = 7\n' },
    })
    const change = derived.changes[0]
    if (change.kind !== 'modify') return

    const outcome = rebaseEdits({
      edits: change.edits,
      baselineLength: baseline.length,
      local: ledger.divergence(PATH),
    })

    expect(outcome.kind).toBe('conflict')
    // Nothing was applied, so the user's version stands.
    expect(ours).toContain('depth = 99')
  })
})
