import { ChangeSet, Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import type { TextEdit } from '@src/contracts/modelingOperations'
import { rebaseEdits } from '@src/features/zookeeper/rebase'

const docOf = (text: string) => Text.of(text.split('\n'))

const localChanges = (baseline: string, ...specs: TextEdit[]) =>
  ChangeSet.of(specs, baseline.length)

const applyLocal = (baseline: string, changes: ChangeSet) =>
  changes.apply(docOf(baseline)).toString()

const applyEdits = (text: string, edits: readonly TextEdit[]) =>
  [...edits]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (current, edit) =>
        current.slice(0, edit.from) + edit.insert + current.slice(edit.to),
      text
    )

describe('rebaseEdits', () => {
  const baseline = 'width = 10\ndepth = 2\nheight = 4\n'

  it('applies verbatim when nobody has touched the file', () => {
    const edits: TextEdit[] = [{ from: 0, to: 10, insert: 'width = 24' }]

    expect(
      rebaseEdits({ edits, baselineLength: baseline.length, local: null })
    ).toEqual({ kind: 'clean', edits })
  })

  it('treats an empty local change set as untouched', () => {
    const edits: TextEdit[] = [{ from: 0, to: 10, insert: 'width = 24' }]
    const local = ChangeSet.empty(baseline.length)

    expect(
      rebaseEdits({ edits, baselineLength: baseline.length, local }).kind
    ).toBe('clean')
  })

  /**
   * The ordinary case under live-apply: the user is editing one part of the file
   * while the agent rewrites another. This has to be silent — asking about it is
   * what would make a collaborator insufferable.
   */
  it('shifts the agent edit past an unrelated change the user made', () => {
    // The user renames `width` on line 1; the agent changes `height` on line 3.
    const local = localChanges(baseline, {
      from: 0,
      to: 5,
      insert: 'thickness',
    })
    const edits: TextEdit[] = [{ from: 21, to: 31, insert: 'height = 9' }]

    const outcome = rebaseEdits({
      edits,
      baselineLength: baseline.length,
      local,
    })

    expect(outcome.kind).toBe('rebased')
    const current = applyLocal(baseline, local)
    expect(applyEdits(current, outcome.edits)).toBe(
      'thickness = 10\ndepth = 2\nheight = 9\n'
    )
  })

  /**
   * The regression this design turns on. Appending at the end of the file is the
   * most common agent edit there is, and the user's caret is very often at the end
   * too. `touchesRange` reports a local insertion at exactly that point as
   * touching, so using it as the oracle would conflict here every time.
   */
  it('does not conflict when the agent appends where the user also typed', () => {
    const local = localChanges(baseline, {
      from: baseline.length,
      to: baseline.length,
      insert: '// mine\n',
    })
    const edits: TextEdit[] = [
      { from: baseline.length, to: baseline.length, insert: '// theirs\n' },
    ]

    const outcome = rebaseEdits({
      edits,
      baselineLength: baseline.length,
      local,
    })

    expect(outcome.kind).toBe('rebased')
    const current = applyLocal(baseline, local)
    expect(applyEdits(current, outcome.edits)).toBe(`${current}// theirs\n`)
  })

  it('does not conflict when the user typed at the boundary of the agent span', () => {
    // Insertion exactly at the start of the range the agent replaces.
    const local = localChanges(baseline, {
      from: 11,
      to: 11,
      insert: '// note\n',
    })
    const edits: TextEdit[] = [{ from: 11, to: 20, insert: 'depth = 7' }]

    const outcome = rebaseEdits({
      edits,
      baselineLength: baseline.length,
      local,
    })

    expect(outcome.kind).toBe('rebased')
    const current = applyLocal(baseline, local)
    // The user's note survives, and the agent's replacement lands on `depth`.
    expect(applyEdits(current, outcome.edits)).toContain('// note')
    expect(applyEdits(current, outcome.edits)).toContain('depth = 7')
  })

  it('reports a conflict when the user edited inside the agent span', () => {
    const local = localChanges(baseline, { from: 14, to: 14, insert: 'DEPTH' })
    const edits: TextEdit[] = [{ from: 11, to: 20, insert: 'depth = 7' }]

    const outcome = rebaseEdits({
      edits,
      baselineLength: baseline.length,
      local,
    })

    expect(outcome).toMatchObject({ kind: 'conflict', reason: 'overlapping' })
    // Baseline coordinates, so a conflict UI can still offer the agent's version.
    if (outcome.kind === 'conflict') expect(outcome.edits).toEqual(edits)
  })

  it('reports the text as erased when the user deleted a span containing it', () => {
    const local = localChanges(baseline, { from: 8, to: 24, insert: '' })
    const edits: TextEdit[] = [{ from: 11, to: 20, insert: 'depth = 7' }]

    expect(
      rebaseEdits({ edits, baselineLength: baseline.length, local })
    ).toMatchObject({ kind: 'conflict', reason: 'erased' })
  })

  /**
   * `touchesRange` returns `"cover"` only on *strict* containment, so a deletion
   * of exactly the agent's range comes back as `true` — indistinguishable from a
   * partial overlap. Read directly, it is unambiguously erased.
   */
  it('reports erased when the user deleted exactly the agent span', () => {
    const local = localChanges(baseline, { from: 11, to: 20, insert: '' })
    const edits: TextEdit[] = [{ from: 11, to: 20, insert: 'depth = 7' }]

    expect(
      rebaseEdits({ edits, baselineLength: baseline.length, local })
    ).toMatchObject({ kind: 'conflict', reason: 'erased' })
  })

  it('reports erased when a deletion spans the point the agent inserts at', () => {
    const local = localChanges(baseline, { from: 8, to: 24, insert: '' })
    const edits: TextEdit[] = [{ from: 15, to: 15, insert: '// here\n' }]

    expect(
      rebaseEdits({ edits, baselineLength: baseline.length, local })
    ).toMatchObject({ kind: 'conflict', reason: 'erased' })
  })

  it('prefers erased over overlapping when both are true of one batch', () => {
    const local = localChanges(
      baseline,
      { from: 3, to: 3, insert: 'X' },
      { from: 11, to: 20, insert: '' }
    )
    const edits: TextEdit[] = [
      { from: 1, to: 6, insert: 'idth ' },
      { from: 11, to: 20, insert: 'depth = 7' },
    ]

    expect(
      rebaseEdits({ edits, baselineLength: baseline.length, local })
    ).toMatchObject({ kind: 'conflict', reason: 'erased' })
  })

  /**
   * Pairing an edit with another file's history would measure every offset
   * against a document neither party saw. Producing a defensible-looking result
   * is the failure mode this whole design exists to avoid, so it fails closed —
   * as a conflict rather than a throw, because this runs mid-stream and an
   * exception here would surface as an unhandled rejection in the socket handler.
   */
  it('refuses local changes that start from a different document', () => {
    const local = localChanges('shorter', { from: 0, to: 1, insert: 'S' })
    const edits: TextEdit[] = [{ from: 0, to: 5, insert: 'width' }]

    expect(
      rebaseEdits({ edits, baselineLength: baseline.length, local })
    ).toMatchObject({ kind: 'conflict', reason: 'baselineMismatch' })
  })

  it('has nothing to do when the agent proposed no edits', () => {
    const local = localChanges(baseline, {
      from: 0,
      to: 5,
      insert: 'thickness',
    })

    expect(
      rebaseEdits({ edits: [], baselineLength: baseline.length, local })
    ).toEqual({ kind: 'clean', edits: [] })
  })
})
