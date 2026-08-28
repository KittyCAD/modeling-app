import { describe, expect, it } from 'vitest'
import { minimalChange } from '@src/lib/buffers/minimalChange'

const apply = (current: string, next: string) => {
  const change = minimalChange(current, next)
  if (change === null) return current
  return (
    current.slice(0, change.from) + change.insert + current.slice(change.to)
  )
}

describe('minimalChange', () => {
  it('has nothing to say about an identical string', () => {
    expect(minimalChange('same', 'same')).toBeNull()
  })

  it('reports an append as an insertion at the end', () => {
    expect(minimalChange('line one\n', 'line one\nline two\n')).toEqual({
      from: 9,
      to: 9,
      insert: 'line two\n',
    })
  })

  it('reports a prepend as an insertion at the start', () => {
    expect(minimalChange('b', 'ab')).toEqual({ from: 0, to: 0, insert: 'a' })
  })

  it('reports a change in the middle as just that span', () => {
    expect(
      minimalChange('width = 10\ndepth = 2\n', 'width = 25\ndepth = 2\n')
    ).toEqual({ from: 8, to: 10, insert: '25' })
  })

  it('reports a deletion with nothing to insert', () => {
    expect(minimalChange('abcdef', 'abef')).toEqual({
      from: 2,
      to: 4,
      insert: '',
    })
  })

  /**
   * The overlap trap: a naive suffix scan run to the end of the shorter string
   * would claim two characters in common on both sides of a two-character
   * string, and produce a change with `to` before `from`.
   */
  it('does not let the prefix and the suffix overlap', () => {
    expect(apply('aaa', 'aa')).toBe('aa')
    expect(apply('aa', 'aaa')).toBe('aaa')
    const change = minimalChange('aaa', 'aa')
    expect(change && change.to >= change.from).toBe(true)
  })

  it('handles an empty document either way', () => {
    expect(apply('', 'hello')).toBe('hello')
    expect(apply('hello', '')).toBe('')
  })

  it('falls back to the whole document when nothing is shared', () => {
    expect(minimalChange('abc', 'xyz')).toEqual({
      from: 0,
      to: 3,
      insert: 'xyz',
    })
  })

  it('round-trips a set of ordinary edits', () => {
    const cases: [string, string][] = [
      ['thickness = 4', 'thickness = 5'],
      ['a\nb\nc\n', 'a\nc\n'],
      ['a\nb\nc\n', 'a\nb\nb\nc\n'],
      ['// header\ncode()\n', 'code()\n'],
      ['x', 'x'],
    ]
    for (const [current, next] of cases) {
      expect(apply(current, next)).toBe(next)
    }
  })
})
