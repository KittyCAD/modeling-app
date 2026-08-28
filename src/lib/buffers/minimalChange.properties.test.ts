import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type MinimalChange,
  minimalChange,
} from '@src/lib/buffers/minimalChange'
import { documentText, repetitiveText } from '@src/test/properties'

/**
 * `minimalChange`, as a set of laws rather than a list of edits.
 *
 * `minimalChange.test.ts` holds the examples — the append, the prepend, the
 * overlap trap — and they are worth keeping: an example says what the function
 * is *for* in a way a property cannot. What the examples cannot do is cover the
 * input space, and this function's callers are the undo history, the selection,
 * and the payload sent to the engine and the language server. All three break in
 * ways that are hard to attribute if the change is subtly wrong for one document
 * in a thousand.
 *
 * So: four laws, checked against generated documents.
 */

const apply = (current: string, change: MinimalChange | null) =>
  change === null
    ? current
    : current.slice(0, change.from) + change.insert + current.slice(change.to)

describe('minimalChange properties', () => {
  /**
   * The one that matters. Everything else here is about *how well* the change is
   * chosen; this is about it being a change at all.
   */
  it('arrives at the new text, whatever the two documents are', () => {
    fc.assert(
      fc.property(documentText, documentText, (current, next) => {
        expect(apply(current, minimalChange(current, next))).toBe(next)
      })
    )
  })

  it('reports a change exactly when there is one', () => {
    fc.assert(
      fc.property(documentText, documentText, (current, next) => {
        expect(minimalChange(current, next) === null).toBe(current === next)
      })
    )
  })

  /**
   * The span has to be a span. A `to` before `from` is the failure mode of a
   * naive suffix scan, and it does not throw — CodeMirror takes it, or the
   * language server does, and the damage surfaces somewhere else entirely.
   *
   * Drawn from the three-character alphabet, because repeats are what make the
   * prefix and the suffix compete for the same characters.
   */
  it('always returns a span inside the old document', () => {
    fc.assert(
      fc.property(repetitiveText, repetitiveText, (current, next) => {
        const change = minimalChange(current, next)
        if (change === null) return

        expect(change.from).toBeGreaterThanOrEqual(0)
        expect(change.to).toBeGreaterThanOrEqual(change.from)
        expect(change.to).toBeLessThanOrEqual(current.length)
      })
    )
  })

  /**
   * Minimal, in the only sense a single replacement can be: neither end of the
   * replaced span agrees with the text going in. If they did, the span could
   * have been one character shorter and still been correct — which is the whole
   * reason this function exists rather than replacing the document.
   */
  it('shares no character with the text it replaces', () => {
    fc.assert(
      fc.property(repetitiveText, repetitiveText, (current, next) => {
        const change = minimalChange(current, next)
        if (change === null) return

        const replaced = current.slice(change.from, change.to)
        if (replaced.length === 0 || change.insert.length === 0) return

        expect(replaced[0]).not.toBe(change.insert[0])
        expect(replaced.at(-1)).not.toBe(change.insert.at(-1))
      })
    )
  })

  /**
   * The practical claim, and the one the doc comment makes: a file that changed
   * in one place comes back as a change in one place. Stated as a bound rather
   * than an equality, because on repetitive text the span legitimately *slides* —
   * inserting `a` into `aaa` can be reported at any of four positions, and all of
   * them are the same size.
   *
   * Without this, a function that returned `{ from: 0, to: length, insert: next }`
   * would satisfy every other property in this file.
   */
  it('costs no more than the edit that was actually made', () => {
    const splice = fc
      .tuple(repetitiveText, fc.nat(), fc.nat(), repetitiveText)
      .map(([current, at, removeLength, inserted]) => {
        const from = current.length === 0 ? 0 : at % (current.length + 1)
        const removed = current.slice(from, from + (removeLength % 8))
        return {
          current,
          removed,
          inserted,
          next:
            current.slice(0, from) +
            inserted +
            current.slice(from + removed.length),
        }
      })

    fc.assert(
      fc.property(splice, ({ current, removed, inserted, next }) => {
        const change = minimalChange(current, next)
        if (change === null) return

        expect(change.to - change.from).toBeLessThanOrEqual(removed.length)
        expect(change.insert.length).toBeLessThanOrEqual(inserted.length)
      })
    )
  })
})
