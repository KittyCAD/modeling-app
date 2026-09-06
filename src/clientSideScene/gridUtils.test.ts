import {
  getGridScaleFactor,
  snapPointToGrid,
} from '@src/clientSideScene/gridUtils'
import { describe, expect, it } from 'vitest'

describe('gridUtils', () => {
  it('keeps fixed-size grids at their configured scale', () => {
    expect(
      getGridScaleFactor({
        majorGridSpacing: 2,
        pixelsPerBaseUnit: 5,
        fixedSizeGrid: true,
      })
    ).toBe(1)
  })

  it('scales dynamic grids by powers of ten to keep major lines visible', () => {
    expect(
      getGridScaleFactor({
        majorGridSpacing: 2,
        pixelsPerBaseUnit: 5,
        fixedSizeGrid: false,
      })
    ).toBe(10)
    expect(
      getGridScaleFactor({
        majorGridSpacing: 2,
        pixelsPerBaseUnit: 5_000,
        fixedSizeGrid: false,
      })
    ).toBe(0.01)
  })

  it('snaps using major spacing, minor divisions, and snaps per minor', () => {
    expect(
      snapPointToGrid([1.13, -0.62], {
        majorGridSpacing: 2,
        minorGridsPerMajor: 4,
        snapsPerMinor: 2,
        pixelsPerBaseUnit: 100,
        fixedSizeGrid: true,
      })
    ).toEqual({ point: [1.25, -0.5], snapped: true })
  })

  it('uses the visible dynamic-grid scale when snapping', () => {
    expect(
      snapPointToGrid([3.6, -3.6], {
        majorGridSpacing: 2,
        minorGridsPerMajor: 4,
        snapsPerMinor: 2,
        pixelsPerBaseUnit: 5,
        fixedSizeGrid: false,
      })
    ).toEqual({ point: [2.5, -2.5], snapped: true })
  })

  it('does not snap when the configured spacing is invalid', () => {
    expect(
      snapPointToGrid([1.2, 3.4], {
        majorGridSpacing: 0,
        minorGridsPerMajor: 4,
        snapsPerMinor: 1,
        pixelsPerBaseUnit: 100,
        fixedSizeGrid: true,
      })
    ).toEqual({ point: [1.2, 3.4], snapped: false })
  })
})
