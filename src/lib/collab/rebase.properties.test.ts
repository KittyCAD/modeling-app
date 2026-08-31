import { ChangeSet, Text } from '@codemirror/state'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { TextEdit } from '@src/contracts/modelingOperations'
import { rebaseEdits } from '@src/lib/collab/rebase'
import { documentText } from '@src/test/properties'

/**
 * `rebaseEdits`, as laws.
 *
 * This is the function the whole live-apply decision rests on. Its output goes
 * straight into `buffer.dispatch` while the user is typing, so the failure it
 * must never have is not "a suboptimal answer" but "an offset that means
 * something else now". CodeMirror answers an out-of-range range with an
 * exception naming neither the agent nor the file, which is the least
 * attributable bug this feature could ship.
 *
 * The law that matters, and the one the design was written around: **for any
 * document, any local edits and any agent edits, this either produces edits that
 * apply cleanly to the document as it now stands, or reports a conflict. It never
 * throws and never produces an out-of-range offset.**
 */

const docOf = (text: string) => Text.of(text.split('\n'))

/**
 * A set of non-overlapping edits inside a document of `length`.
 *
 * Built by walking a cursor forward so each edit starts at or after the previous
 * one ended. Zero-length gaps and spans are deliberately reachable: two
 * insertions at one offset, and an insertion at the very end of the file, are the
 * cases the boundary handling turns on.
 */
const editsWithin = (length: number) =>
  fc
    .array(
      fc.record({
        gap: fc.nat(8),
        span: fc.nat(4),
        insert: fc.string({
          unit: fc.constantFrom('x', 'y', '\n'),
          maxLength: 4,
        }),
      }),
      { maxLength: 4 }
    )
    .map((specs) => {
      const edits: TextEdit[] = []
      let cursor = 0
      for (const { gap, span, insert } of specs) {
        const from = Math.min(cursor + gap, length)
        const to = Math.min(from + span, length)
        edits.push({ from, to, insert })
        cursor = to
      }
      return edits
    })

const scenario = documentText.chain((baseline) =>
  fc.record({
    baseline: fc.constant(baseline),
    agent: editsWithin(baseline.length),
    local: editsWithin(baseline.length),
  })
)

const asChangeSet = (edits: readonly TextEdit[], length: number) =>
  edits.length === 0 ? null : ChangeSet.of([...edits], length)

describe('rebaseEdits properties', () => {
  it('never throws when the baseline and the local history agree', () => {
    fc.assert(
      fc.property(scenario, ({ baseline, agent, local }) => {
        expect(() =>
          rebaseEdits({
            edits: agent,
            baselineLength: baseline.length,
            local: asChangeSet(local, baseline.length),
          })
        ).not.toThrow()
      })
    )
  })

  /**
   * The central law. Whatever it hands back as applicable has to be applicable —
   * `ChangeSet.of` against the current document is exactly the check `dispatch`
   * would perform, so passing it is the guarantee.
   */
  it('produces edits that apply to the document as it now stands', () => {
    fc.assert(
      fc.property(scenario, ({ baseline, agent, local }) => {
        const changes = asChangeSet(local, baseline.length)
        const outcome = rebaseEdits({
          edits: agent,
          baselineLength: baseline.length,
          local: changes,
        })

        if (outcome.kind === 'conflict') return

        const current =
          changes === null
            ? baseline
            : changes.apply(docOf(baseline)).toString()

        for (const edit of outcome.edits) {
          expect(edit.from).toBeGreaterThanOrEqual(0)
          expect(edit.to).toBeGreaterThanOrEqual(edit.from)
          expect(edit.to).toBeLessThanOrEqual(current.length)
        }

        expect(() =>
          ChangeSet.of([...outcome.edits], current.length)
        ).not.toThrow()
      })
    )
  })

  it('reports clean exactly when the document has not moved', () => {
    fc.assert(
      fc.property(scenario, ({ baseline, agent, local }) => {
        const changes = asChangeSet(local, baseline.length)
        const outcome = rebaseEdits({
          edits: agent,
          baselineLength: baseline.length,
          local: changes,
        })

        const untouched =
          changes === null || changes.empty || agent.length === 0
        expect(outcome.kind === 'clean').toBe(untouched)
      })
    )
  })

  /**
   * Rebasing moves the agent's text; it must not lose or invent any. A dropped
   * insertion would be the worst possible outcome, because the file would look
   * plausibly edited and quietly disagree with what the model believes it wrote.
   */
  it('preserves every character the agent inserted', () => {
    fc.assert(
      fc.property(scenario, ({ baseline, agent, local }) => {
        const outcome = rebaseEdits({
          edits: agent,
          baselineLength: baseline.length,
          local: asChangeSet(local, baseline.length),
        })

        if (outcome.kind === 'conflict') return

        const inserted = (edits: readonly TextEdit[]) =>
          edits.map((edit) => edit.insert).join('')

        expect(inserted(outcome.edits)).toBe(inserted(agent))
      })
    )
  })

  /**
   * A conflict must be reported in baseline coordinates, so the conflict UI can
   * offer the agent's version as the agent actually wrote it. Mapped offsets
   * would describe a change against a document the agent never saw.
   */
  it('reports conflicts in the coordinates the agent used', () => {
    fc.assert(
      fc.property(scenario, ({ baseline, agent, local }) => {
        const outcome = rebaseEdits({
          edits: agent,
          baselineLength: baseline.length,
          local: asChangeSet(local, baseline.length),
        })

        if (outcome.kind !== 'conflict') return
        expect(outcome.edits).toEqual(agent)
      })
    )
  })
})
