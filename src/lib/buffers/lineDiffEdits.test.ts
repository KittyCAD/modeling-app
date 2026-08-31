import { describe, expect, it } from 'vitest'
import type { TextEdit } from '@src/contracts/modelingOperations'
import { lineDiffEdits } from '@src/lib/buffers/lineDiffEdits'

const applyEdits = (before: string, edits: readonly TextEdit[]) =>
  [...edits]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (text, edit) =>
        text.slice(0, edit.from) + edit.insert + text.slice(edit.to),
      before
    )

/** A KCL-ish file long enough to be past the escalation floor. */
const longFile = (body: string) =>
  `@settings(defaultLengthUnit = mm)\n\n${'// padding that keeps the file well over the character floor\n'.repeat(
    8
  )}${body}`

describe('lineDiffEdits', () => {
  it('has nothing to say about identical text', () => {
    expect(lineDiffEdits('width = 10\n', 'width = 10\n')).toEqual([])
  })

  it('reports a small change as one replacement, without escalating', () => {
    const before = 'width = 10\ndepth = 2\n'
    const after = 'width = 24\ndepth = 2\n'

    const edits = lineDiffEdits(before, after)

    expect(edits).toHaveLength(1)
    expect(applyEdits(before, edits)).toBe(after)
  })

  /**
   * The case the escalation exists for, and the one `textDiff` alone gets wrong:
   * a change at the top and a change at the bottom of the same file. The
   * smallest single span covering both is nearly the whole document, which is a
   * full replacement wearing a diff's clothes.
   */
  it('splits a change at each end of a long file into two edits', () => {
    const before = longFile('width = 10\n')
    const after = longFile(
      'width = 10\nextrude(sketch001, length = 5)\n'
    ).replace('defaultLengthUnit = mm', 'defaultLengthUnit = in')

    const edits = lineDiffEdits(before, after)

    expect(edits.length).toBeGreaterThan(1)
    expect(applyEdits(before, edits)).toBe(after)

    // Neither edit covers the untouched middle of the file.
    const covered = edits.reduce(
      (total, edit) => total + (edit.to - edit.from),
      0
    )
    expect(covered).toBeLessThan(before.length / 2)
  })

  it('leaves a genuinely scattered rewrite of a short file as one edit', () => {
    const before = 'a\nb\nc\n'
    const after = 'x\nb\ny\n'

    // Short enough that a real diff could only describe the same change with
    // more edits, so the cheap answer stands.
    expect(lineDiffEdits(before, after)).toHaveLength(1)
  })

  it('handles an append to a long file without touching what came before', () => {
    const before = longFile('width = 10\n')
    const after = `${before}extrude(sketch001, length = 5)\n`

    const edits = lineDiffEdits(before, after)

    expect(applyEdits(before, edits)).toBe(after)
    for (const edit of edits) expect(edit.from).toBeGreaterThan(0)
  })

  it('handles a long file becoming empty', () => {
    const before = longFile('width = 10\n')

    expect(applyEdits(before, lineDiffEdits(before, ''))).toBe('')
  })

  it('handles an empty file gaining a long body', () => {
    const after = longFile('width = 10\n')

    expect(applyEdits('', lineDiffEdits('', after))).toBe(after)
  })
})
