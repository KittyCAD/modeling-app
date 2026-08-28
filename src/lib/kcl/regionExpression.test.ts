import { describe, expect, it } from 'vitest'
import { regionExpression } from '@src/lib/kcl/regionExpression'

const boundary = (over: Partial<Parameters<typeof regionExpression>[0]> = {}) =>
  regionExpression({
    segments: ['triangle.line1', 'triangle.line2'],
    intersectionIndex: 0,
    intersectionCount: 1,
    clockwise: false,
    ...over,
  })

describe('regionExpression', () => {
  it('writes the two bordering segments', () => {
    expect(boundary()).toBe(
      'region(segments = [triangle.line1, triangle.line2])'
    )
  })

  /**
   * The docs are explicit that these are unnecessary for a single loop, and
   * writing them anyway makes generated KCL look machine-made.
   */
  it('leaves out the disambiguators when they say nothing', () => {
    const written = boundary({ intersectionIndex: 0, intersectionCount: 1 })
    expect(written).not.toContain('intersectionIndex')
    expect(written).not.toContain('direction')
  })

  it('names the crossing when the curves cross more than once', () => {
    expect(boundary({ intersectionIndex: 2, intersectionCount: 4 })).toContain(
      'intersectionIndex = 2'
    )
  })

  it('names the direction only when it is not the default', () => {
    expect(boundary({ clockwise: true })).toContain('direction = CW')
    expect(boundary({ clockwise: false })).not.toContain('direction')
  })

  /** A circle: one closed segment, so one entry. */
  it('accepts a single segment', () => {
    expect(boundary({ segments: ['circle1'] })).toBe(
      'region(segments = [circle1])'
    )
  })

  it('has nothing to write with no segments', () => {
    expect(boundary({ segments: [] })).toBeNull()
  })
})
