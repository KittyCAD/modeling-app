import {
  getArcBodySections,
  getArcLabelOffset,
} from '@src/machines/sketchSolve/constraints/ArcDimensionLine'
import { describe, expect, it } from 'vitest'

describe('angle arc body sections', () => {
  it('splits the measured arc around an in-angle label', () => {
    const sweep = Math.PI / 3
    const halfGap = 0.1
    const labelOffset = getArcLabelOffset(0, sweep, Math.PI / 6)

    const sections = getArcBodySections(0, sweep, labelOffset, halfGap)

    expect(labelOffset).toBeCloseTo(Math.PI / 6)
    expect(sections).toHaveLength(2)
    expect(sections[0][0]).toBeCloseTo(0)
    expect(sections[0][1]).toBeCloseTo(Math.PI / 6 - halfGap)
    expect(sections[1][0]).toBeCloseTo(Math.PI / 6 + halfGap)
    expect(sections[1][1]).toBeCloseTo(sweep)
  })

  it('overdraws before the measured start when the label is before the arc', () => {
    const sweep = Math.PI / 3
    const halfGap = 0.1
    const labelOffset = getArcLabelOffset(0, sweep, -Math.PI / 6)

    const sections = getArcBodySections(0, sweep, labelOffset, halfGap)

    expect(labelOffset).toBeCloseTo(-Math.PI / 6)
    expect(sections).toHaveLength(1)
    expect(sections[0][0]).toBeCloseTo(-Math.PI / 6 + halfGap)
    expect(sections[0][1]).toBeCloseTo(sweep)
  })

  it('overdraws after the measured end when the label is after the arc', () => {
    const sweep = Math.PI / 3
    const halfGap = 0.1
    const labelOffset = getArcLabelOffset(0, sweep, Math.PI / 2)

    const sections = getArcBodySections(0, sweep, labelOffset, halfGap)

    expect(labelOffset).toBeCloseTo(Math.PI / 2)
    expect(sections).toHaveLength(1)
    expect(sections[0][0]).toBeCloseTo(0)
    expect(sections[0][1]).toBeCloseTo(Math.PI / 2 - halfGap)
  })
})
