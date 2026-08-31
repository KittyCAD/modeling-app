import { describe, expect, it } from 'vitest'
import {
  CONFLICT_COLOR,
  DARK_CONSTRAINED_COLOR,
  DRAFT_COLOR,
  LIGHT_CONSTRAINED_COLOR,
  SKETCH_HIGHLIGHT_COLOR,
  SKETCH_SELECTION_COLOR,
  UNCONSTRAINED_COLOR,
  getPointSegmentScale,
  getSegmentColor,
  getSegmentLineWidth,
} from '@src/lib/sketch/appearance'

describe('the sketch colours ported from the existing app', () => {
  it('packs the selection and highlight to the same values', () => {
    expect(SKETCH_SELECTION_COLOR).toBe('#ffb727')
    // 70% of the selection colour, rounded per channel.
    expect(SKETCH_HIGHLIGHT_COLOR).toBe('#b3801b')
  })
})

describe('getSegmentColor', () => {
  it('shows freedom when nothing else applies', () => {
    expect(getSegmentColor({ freedom: 'Free', theme: 'dark' })).toBe(
      UNCONSTRAINED_COLOR
    )
    expect(getSegmentColor({ freedom: 'Conflict', theme: 'dark' })).toBe(
      CONFLICT_COLOR
    )
  })

  it('draws constrained geometry against the theme', () => {
    expect(getSegmentColor({ freedom: 'Fixed', theme: 'dark' })).toBe(
      DARK_CONSTRAINED_COLOR
    )
    expect(getSegmentColor({ freedom: 'Fixed', theme: 'light' })).toBe(
      LIGHT_CONSTRAINED_COLOR
    )
  })

  it('treats unknown freedom as unconstrained', () => {
    // A point the solver has not spoken about is not a point that is pinned.
    expect(getSegmentColor({ freedom: null, theme: 'dark' })).toBe(
      UNCONSTRAINED_COLOR
    )
    expect(getSegmentColor({ theme: 'dark' })).toBe(UNCONSTRAINED_COLOR)
  })

  /*
   * The precedence is the interesting part, and it is not obvious. These are the
   * cases where two things are true at once.
   */
  it('shows a selected segment as selected even when it is in conflict', () => {
    // You are looking at it because you selected it; the error is reported
    // elsewhere. Backwards, and a selection appears not to have worked.
    expect(
      getSegmentColor({ isSelected: true, freedom: 'Conflict', theme: 'dark' })
    ).toBe(SKETCH_SELECTION_COLOR)
  })

  it('shows a hover over a selected segment as hovered', () => {
    expect(
      getSegmentColor({ isHovered: true, isSelected: true, theme: 'dark' })
    ).toBe(SKETCH_HIGHLIGHT_COLOR)
  })

  it('shows a draft as a draft whatever else is true of it', () => {
    expect(
      getSegmentColor({
        isDraft: true,
        isHovered: true,
        isSelected: true,
        freedom: 'Conflict',
        theme: 'dark',
      })
    ).toBe(DRAFT_COLOR)
  })

  it('shows a solver failure as a conflict', () => {
    expect(
      getSegmentColor({ hasSolveErrors: true, freedom: 'Fixed', theme: 'dark' })
    ).toBe(CONFLICT_COLOR)
  })

  it('takes a hover colour from the caller when it has one', () => {
    expect(
      getSegmentColor({ isHovered: true, hoverColor: '#03e7b6', theme: 'dark' })
    ).toBe('#03e7b6')
  })
})

describe('getPointSegmentScale', () => {
  it('leaves a point alone until it is hovered', () => {
    expect(getPointSegmentScale({})).toBe(1)
    expect(getPointSegmentScale({ isSecondaryHovered: true })).toBe(1)
  })

  it('grows a hovered point, and a secondary one further', () => {
    expect(getPointSegmentScale({ isHovered: true })).toBe(1.5)
    expect(
      getPointSegmentScale({ isHovered: true, isSecondaryHovered: true })
    ).toBe(2)
  })
})

describe('getSegmentLineWidth', () => {
  it('only thickens for a secondary hover', () => {
    // An ordinary hover recolours and leaves the width alone, so a row of
    // segments does not shift as the pointer crosses them.
    expect(getSegmentLineWidth({ isHovered: true })).toBe(1.6)
    expect(
      getSegmentLineWidth({ isHovered: true, isSecondaryHovered: true })
    ).toBeCloseTo(3.6)
  })
})
