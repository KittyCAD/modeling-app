import { describe, expect, it } from 'vitest'
import { resolveSketchPoint } from '@src/machines/sketchSolve/tools/sketchCoordinates'

describe('resolveSketchPoint', () => {
  it.each([0.125, 2.3333 / 17, 0.0000125])('preserves snapped %s', (x) => {
    expect(resolveSketchPoint([1, 2], { position: [x, -x] })).toEqual([x, -x])
  })

  it('retains two-decimal precision for free cursor input', () => {
    expect(resolveSketchPoint([1.234, -5.678], null)).toEqual([1.23, -5.68])
  })
})
