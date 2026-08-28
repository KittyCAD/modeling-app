import { describe, expect, it } from 'vitest'
import { mergeTextEdits } from '@src/features/modelingOperations/mergeEdits'

const edit = (from: number, to: number, insert: string) => ({
  from,
  to,
  insert,
})

describe('mergeTextEdits', () => {
  it('orders edits by where they land', () => {
    expect(mergeTextEdits([edit(40, 40, 'b'), edit(10, 10, 'a')])).toEqual([
      edit(10, 10, 'a'),
      edit(40, 40, 'b'),
    ])
  })

  /**
   * The hazard this exists for: two arguments needing the same segment named
   * would each ask for the same insertion, and CodeMirror rejects two changes
   * covering the same text.
   */
  it('collapses two identical requests into one', () => {
    const tag = edit(120, 120, ', tag = $seg01')

    expect(mergeTextEdits([tag, tag, edit(200, 200, 'x')])).toEqual([
      tag,
      edit(200, 200, 'x'),
    ])
  })

  it('keeps two different inserts at the same offset', () => {
    // Not a conflict: both are insertions at a point, so they are ordered
    // rather than overlapping.
    const merged = mergeTextEdits([edit(50, 50, 'a'), edit(50, 50, 'b')])
    expect(merged).toHaveLength(2)
  })

  it('refuses two changes that cover the same text, in its own words', () => {
    expect(() =>
      mergeTextEdits([edit(10, 20, 'first'), edit(15, 25, 'second')])
    ).toThrow(/cover the same text/)
  })

  it('has nothing to do with an empty set', () => {
    expect(mergeTextEdits([])).toEqual([])
  })
})
