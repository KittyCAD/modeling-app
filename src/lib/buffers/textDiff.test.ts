import { describe, expect, it } from 'vitest'
import { textDiff } from '@src/lib/buffers/textDiff'

/** What the edit produces, so a test says what it means rather than where. */
const applied = (before: string, after: string) => {
  const edits = textDiff(before, after)
  return edits.reduce(
    (text, edit) =>
      text.slice(0, edit.from) + edit.insert + text.slice(edit.to),
    before
  )
}

describe('recovering the change from a rewritten file', () => {
  it('has nothing to say when nothing changed', () => {
    expect(textDiff('a = 1\n', 'a = 1\n')).toEqual([])
  })

  it('finds an insertion in the middle', () => {
    const before = 's = sketch(on = XY) {\n}\n'
    const after = 's = sketch(on = XY) {\n  l1 = line()\n}\n'

    expect(textDiff(before, after)).toEqual([
      { from: 22, to: 22, insert: '  l1 = line()\n' },
    ])
    expect(applied(before, after)).toBe(after)
  })

  it('finds a deletion', () => {
    const before = 'a = 1\nb = 2\nc = 3\n'
    const after = 'a = 1\nc = 3\n'

    expect(textDiff(before, after)).toEqual([{ from: 6, to: 12, insert: '' }])
    expect(applied(before, after)).toBe(after)
  })

  it('finds a replacement', () => {
    expect(textDiff('length = 10', 'length = 25')).toEqual([
      { from: 9, to: 11, insert: '25' },
    ])
  })

  it('describes an append as an append, not a rewrite', () => {
    const before = 'a = 1\n'
    const edits = textDiff(before, 'a = 1\nb = 2\n')

    expect(edits).toEqual([{ from: 6, to: 6, insert: 'b = 2\n' }])
  })

  /*
   * The case the suffix guard exists for: the repeated character belongs to the
   * insertion, and counting it from both ends produces a backwards range.
   */
  it('does not let the prefix and the suffix claim the same text', () => {
    expect(textDiff('ab', 'aab')).toEqual([{ from: 1, to: 1, insert: 'a' }])
    expect(applied('ab', 'aab')).toBe('aab')
    expect(applied('aab', 'ab')).toBe('ab')
  })

  it('handles a file becoming empty, and starting from empty', () => {
    expect(textDiff('a = 1\n', '')).toEqual([{ from: 0, to: 6, insert: '' }])
    expect(textDiff('', 'a = 1\n')).toEqual([
      { from: 0, to: 0, insert: 'a = 1\n' },
    ])
  })

  it('never produces a backwards range, whatever it is given', () => {
    const samples = ['', 'a', 'aa', 'abc', 'abcabc', 'x = 1\ny = 2\n', 'aaa\n']

    for (const before of samples) {
      for (const after of samples) {
        for (const edit of textDiff(before, after)) {
          expect(edit.to).toBeGreaterThanOrEqual(edit.from)
          expect(edit.to).toBeLessThanOrEqual(before.length)
        }
        expect(applied(before, after)).toBe(after)
      }
    }
  })
})
