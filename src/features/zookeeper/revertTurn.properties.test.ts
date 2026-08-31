import { ChangeSet, Text } from '@codemirror/state'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type AppliedChange,
  inverseForTurn,
} from '@src/features/zookeeper/revertTurn'

/**
 * Reverting a turn, as laws.
 *
 * Under live-apply this is the only recourse after a bad edit lands, so the
 * guarantee people need is not "it undoes the agent" but "it does not take my
 * work with it". Both are asserted here, and they are asserted with *marked*
 * text: the agent only ever inserts `A`, the user only ever inserts `U`, and the
 * baseline is made of neither. Counting characters afterwards is then an exact
 * statement about who lost what, which a structural assertion about ranges could
 * not give.
 *
 * Insert-only changes, deliberately. Deletions are covered by example in
 * `revertTurn.test.ts`, where the expected document can be written down; mixing
 * them in here would make the character counts a claim about the generator rather
 * than about the code.
 */

const TURN = 'turn-1'

const baselineText = fc.string({
  unit: fc.constantFrom('b', '\n'),
  maxLength: 30,
})

const insertion = fc.record({
  mine: fc.boolean(),
  at: fc.nat(40),
  length: fc.integer({ min: 1, max: 4 }),
})

const countOf = (text: string, character: string) =>
  [...text].filter((each) => each === character).length

describe('inverseForTurn properties', () => {
  const build = (
    baseline: string,
    insertions: readonly { mine: boolean; at: number; length: number }[]
  ) => {
    const applied: AppliedChange[] = []
    let doc = Text.of(baseline.split('\n'))
    let agentInserted = 0
    let userInserted = 0

    for (const spec of insertions) {
      const from = Math.min(spec.at, doc.length)
      const insert = (spec.mine ? 'A' : 'U').repeat(spec.length)
      const changes = ChangeSet.of([{ from, to: from, insert }], doc.length)

      applied.push({ changes, docBefore: doc, turnId: spec.mine ? TURN : null })
      doc = changes.apply(doc)

      if (spec.mine) agentInserted += spec.length
      else userInserted += spec.length
    }

    return { applied, doc, agentInserted, userInserted }
  }

  it('removes everything the turn inserted', () => {
    fc.assert(
      fc.property(
        baselineText,
        fc.array(insertion, { maxLength: 10 }),
        (baseline, insertions) => {
          const { applied, doc } = build(baseline, insertions)
          const inverse = inverseForTurn({ applied, turnId: TURN })

          const reverted =
            inverse.changes === null
              ? doc.toString()
              : inverse.changes.apply(doc).toString()

          expect(countOf(reverted, 'A')).toBe(0)
        }
      )
    )
  })

  /**
   * The law that matters most. Whatever the agent did and whatever order it
   * happened in, undoing the agent must not cost the user a single character.
   */
  it('never destroys a character the user typed', () => {
    fc.assert(
      fc.property(
        baselineText,
        fc.array(insertion, { maxLength: 10 }),
        (baseline, insertions) => {
          const { applied, doc, userInserted } = build(baseline, insertions)
          const inverse = inverseForTurn({ applied, turnId: TURN })

          const reverted =
            inverse.changes === null
              ? doc.toString()
              : inverse.changes.apply(doc).toString()

          expect(countOf(reverted, 'U')).toBe(userInserted)
        }
      )
    )
  })

  it('leaves the original document intact', () => {
    fc.assert(
      fc.property(
        baselineText,
        fc.array(insertion, { maxLength: 10 }),
        (baseline, insertions) => {
          const { applied, doc } = build(baseline, insertions)
          const inverse = inverseForTurn({ applied, turnId: TURN })

          const reverted =
            inverse.changes === null
              ? doc.toString()
              : inverse.changes.apply(doc).toString()

          // Neither marker appears in the baseline, so what remains of it is
          // exactly what the revert must have preserved untouched.
          expect(countOf(reverted, 'b')).toBe(countOf(baseline, 'b'))
        }
      )
    )
  })

  it('produces an inverse that applies to the current document', () => {
    fc.assert(
      fc.property(
        baselineText,
        fc.array(insertion, { maxLength: 10 }),
        (baseline, insertions) => {
          const { applied, doc } = build(baseline, insertions)
          const inverse = inverseForTurn({ applied, turnId: TURN })

          if (inverse.changes === null) return
          expect(inverse.changes.length).toBe(doc.length)
          expect(() => inverse.changes?.apply(doc)).not.toThrow()
        }
      )
    )
  })

  it('has nothing to undo when the turn did nothing', () => {
    fc.assert(
      fc.property(
        baselineText,
        fc.array(insertion, { maxLength: 6 }),
        (baseline, insertions) => {
          const onlyTheirs = insertions.map((spec) => ({
            ...spec,
            mine: false,
          }))
          const { applied } = build(baseline, onlyTheirs)

          expect(inverseForTurn({ applied, turnId: TURN })).toEqual({
            changes: null,
            stranded: [],
          })
        }
      )
    )
  })
})
