import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { TextEdit } from '@src/contracts/modelingOperations'
import { mergeTextEdits } from '@src/features/modelingOperations/mergeEdits'
import { lineDiffEdits } from '@src/lib/buffers/lineDiffEdits'
import { documentText } from '@src/test/properties'

/**
 * `lineDiffEdits`, as laws.
 *
 * The examples live beside this in `lineDiffEdits.test.ts` and say what the
 * function is *for*. These say what must be true of it for anything downstream to
 * be safe, and they matter more here than for most functions: the output is fed
 * straight into `buffer.dispatch`, so an edit whose offsets are wrong for one
 * document in a thousand is a corrupted file in someone's project, attributed to
 * an agent, with the original only recoverable through undo.
 *
 * Applying against the original in descending offset order is how a caller with
 * every offset measured against one document applies them without mapping — the
 * same thing one CodeMirror transaction does.
 */
const applyEdits = (before: string, edits: readonly TextEdit[]) =>
  [...edits]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (text, edit) =>
        text.slice(0, edit.from) + edit.insert + text.slice(edit.to),
      before
    )

/**
 * Documents long enough to reach the escalation floor.
 *
 * `documentText` tops out around forty characters, so on its own it only ever
 * exercises the `textDiff` branch — the laws below would hold without the line
 * diff existing at all. These draw many short lines, which is both the shape of
 * a KCL file and the shape that makes a line diff disagree with a single span.
 */
const longDocumentText = fc
  .array(
    fc.constantFrom(
      'sketch001 = startSketchOn(XY)\n',
      'width = 10\n',
      'depth = 2\n',
      '// a comment\n',
      'extrude(sketch001, length = 5)\n',
      'a\n',
      '\n'
    ),
    { minLength: 30, maxLength: 60 }
  )
  .map((lines) => lines.join(''))

/** Both branches: short documents and ones past the escalation floor. */
const anyDocumentText = fc.oneof(documentText, longDocumentText)

describe('lineDiffEdits properties', () => {
  /**
   * The one that matters. Whatever the two documents are, and whichever branch
   * the escalation takes, the edit has to reconstruct the file the agent sent —
   * otherwise the app and the model disagree about what is on disk, and every
   * later turn compounds it.
   */
  it('reconstructs the new text, whatever the two documents are', () => {
    fc.assert(
      fc.property(anyDocumentText, anyDocumentText, (before, after) => {
        expect(applyEdits(before, lineDiffEdits(before, after))).toBe(after)
      })
    )
  })

  it('reports a change exactly when there is one', () => {
    fc.assert(
      fc.property(anyDocumentText, anyDocumentText, (before, after) => {
        expect(lineDiffEdits(before, after).length === 0).toBe(before === after)
      })
    )
  })

  /**
   * Every offset is against the original document. A `to` past the end, or a
   * reversed range, is the failure CodeMirror reports as a range error with no
   * mention of what produced it.
   */
  it('measures every offset against the original document', () => {
    fc.assert(
      fc.property(anyDocumentText, anyDocumentText, (before, after) => {
        for (const edit of lineDiffEdits(before, after)) {
          expect(edit.from).toBeGreaterThanOrEqual(0)
          expect(edit.to).toBeGreaterThanOrEqual(edit.from)
          expect(edit.to).toBeLessThanOrEqual(before.length)
        }
      })
    )
  })

  /**
   * The result has to survive the guard the modelling path already puts in front
   * of `dispatch`. `mergeTextEdits` throws on genuinely overlapping edits, so
   * passing it is the assertion that this produced a coherent set rather than
   * several descriptions of the same text.
   */
  it('produces a set that mergeTextEdits accepts', () => {
    fc.assert(
      fc.property(anyDocumentText, anyDocumentText, (before, after) => {
        expect(() => mergeTextEdits(lineDiffEdits(before, after))).not.toThrow()
      })
    )
  })

  /**
   * Merging must not change what the edit *means*. It sorts and dedupes, so if
   * the two disagreed about the resulting document one of them would be applying
   * a different change than the other reviewed.
   */
  it('means the same thing after merging as before', () => {
    fc.assert(
      fc.property(anyDocumentText, anyDocumentText, (before, after) => {
        const edits = lineDiffEdits(before, after)
        expect(applyEdits(before, mergeTextEdits(edits))).toBe(after)
      })
    )
  })
})
