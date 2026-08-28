import { byteOffsetToUtf16, sourceRangeToUtf16 } from '@src/lib/kcl/sourceRange'
import { describe, expect, it } from 'vitest'

describe('KCL source offsets', () => {
  it('leaves ASCII offsets alone', () => {
    expect(sourceRangeToUtf16('cube()', [1, 5, 0])).toEqual([1, 5])
  })

  it('converts UTF-8 bytes to CodeMirror UTF-16 positions', () => {
    const source = 'a = "é🦊"\ncube()'
    const cubeStart = new TextEncoder().encode('a = "é🦊"\n').byteLength

    expect(byteOffsetToUtf16(source, cubeStart)).toBe(source.indexOf('cube'))
    expect(sourceRangeToUtf16(source, [cubeStart, cubeStart + 4, 0])).toEqual([
      source.indexOf('cube'),
      source.indexOf('cube') + 4,
    ])
  })
})
