import { ChangeSet, Text } from '@codemirror/state'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createDivergenceLedger } from '@src/features/zookeeper/divergence'
import { rebaseEdits } from '@src/features/zookeeper/rebase'
import { documentText } from '@src/test/properties'

/**
 * The divergence ledger, as one law.
 *
 * **At every moment, the divergence applied to the agent's document must produce
 * ours.** That is the entire contract, and it is worth stating as a law rather
 * than a set of examples because the way it breaks is silent: a mis-ordered
 * `map` still returns a `ChangeSet` of a plausible length, so the next rebase for
 * that path succeeds and writes text at positions measured against a document
 * nobody has. Nothing throws. The file just quietly gains the agent's edit in
 * the wrong place.
 *
 * The simulation below is the real thing in miniature: an agent editing its own
 * copy, a user editing ours, interleaved in any order, with every agent edit
 * going through `rebaseEdits` exactly as it would in the app.
 */

const docOf = (text: string) => Text.of(text.split('\n'))

const applyChanges = (text: string, changes: ChangeSet) =>
  changes.apply(docOf(text)).toString()

/** One edit, clamped to whatever the document currently is. */
const step = fc.record({
  kind: fc.constantFrom<'local' | 'agent'>('local', 'agent'),
  gap: fc.nat(12),
  span: fc.nat(5),
  insert: fc.string({ unit: fc.constantFrom('x', 'y', '\n'), maxLength: 4 }),
})

const changesFor = (
  length: number,
  spec: { gap: number; span: number; insert: string }
) => {
  const from = Math.min(spec.gap, length)
  const to = Math.min(from + spec.span, length)
  return ChangeSet.of([{ from, to, insert: spec.insert }], length)
}

const PATH = 'main.kcl'

describe('divergence ledger properties', () => {
  it('always maps the agent document onto ours', () => {
    fc.assert(
      fc.property(
        documentText,
        fc.array(step, { maxLength: 12 }),
        (baseline, steps) => {
          const ledger = createDivergenceLedger()
          ledger.begin(PATH, baseline.length)

          let agentDoc = baseline
          let ourDoc = baseline

          const holds = () => {
            const drift = ledger.divergence(PATH)
            if (drift === null) {
              expect(ourDoc).toBe(agentDoc)
              return
            }
            expect(drift.length).toBe(agentDoc.length)
            expect(applyChanges(agentDoc, drift)).toBe(ourDoc)
          }

          holds()

          for (const spec of steps) {
            if (spec.kind === 'local') {
              const local = changesFor(ourDoc.length, spec)
              ourDoc = applyChanges(ourDoc, local)
              ledger.recordLocal(PATH, local)
              holds()
              continue
            }

            // The agent edits its own copy, in its own coordinates.
            const agentChanges = changesFor(agentDoc.length, spec)
            const edits: { from: number; to: number; insert: string }[] = []
            agentChanges.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
              edits.push({ from: fromA, to: toA, insert: inserted.toString() })
            })
            if (edits.length === 0) continue

            const outcome = rebaseEdits({
              edits,
              baselineLength: agentDoc.length,
              local: ledger.divergence(PATH),
            })

            /*
             * A refused edit means the agent's copy and ours have genuinely
             * disagreed, and the app's answer is to ask the user and resync — so
             * the invariant is not claimed past that point.
             */
            if (outcome.kind === 'conflict') return

            ourDoc = applyChanges(
              ourDoc,
              ChangeSet.of([...outcome.edits], ourDoc.length)
            )
            agentDoc = applyChanges(agentDoc, agentChanges)
            ledger.recordAgent(PATH, agentChanges)
            holds()
          }
        }
      )
    )
  })

  it('reports no divergence for a path it does not track', () => {
    fc.assert(
      fc.property(documentText, step, (baseline, spec) => {
        const ledger = createDivergenceLedger()
        // Never `begin`, so recording is a no-op rather than an error.
        ledger.recordLocal(PATH, changesFor(baseline.length, spec))
        expect(ledger.divergence(PATH)).toBeNull()
        expect(ledger.tracks(PATH)).toBe(false)
      })
    )
  })

  /**
   * The misuse that the round-trip law cannot see, because a caller doing this
   * has already left the model the law describes: recording an agent edit without
   * applying it, or applying one without recording it. Before the guard existed,
   * the ledger accepted it and stayed a plausible length, so the *next* rebase
   * silently wrote at positions from a document that never existed.
   *
   * This property was originally written as a length invariant and failed on its
   * first run for exactly this reason — the simulation was impossible, and the
   * ledger agreed to it anyway.
   */
  it('refuses a change that does not start where it should', () => {
    fc.assert(
      fc.property(documentText, step, (baseline, spec) => {
        const ledger = createDivergenceLedger()
        ledger.begin(PATH, baseline.length)

        // Move the agent's document without applying anything to ours.
        const agentChanges = changesFor(baseline.length, spec)
        if (agentChanges.empty) return
        expect(ledger.recordAgent(PATH, agentChanges)).toBe(true)

        /*
         * Our document is still the baseline, but the divergence now says it
         * should be longer or shorter. A local change measured against the real
         * document therefore no longer starts where the drift ends.
         */
        const drift = ledger.divergence(PATH)
        if (drift === null || drift.newLength === baseline.length) return

        const local = ChangeSet.of(
          [{ from: 0, to: 0, insert: 'z' }],
          baseline.length
        )
        expect(ledger.recordLocal(PATH, local)).toBe(false)
        // And it changed nothing, so the drift is still the one it was.
        expect(ledger.divergence(PATH)).toBe(drift)
      })
    )
  })
})
