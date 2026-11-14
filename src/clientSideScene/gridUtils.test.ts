import {
  getGridScaleFactor,
  snapPointToGrid,
} from '@src/clientSideScene/gridUtils'
import fc from 'fast-check'
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

  it('allows fractional snaps per minor to snap every other grid line', () => {
    expect(
      snapPointToGrid([8.8, -11.1], {
        majorGridSpacing: 5,
        minorGridsPerMajor: 1,
        snapsPerMinor: 0.5,
        pixelsPerBaseUnit: 100,
        fixedSizeGrid: true,
      })
    ).toEqual({ point: [10, -10], snapped: true })
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

describe('grid coordinate precision', () => {
  const options = {
    majorGridSpacing: 2.3333,
    minorGridsPerMajor: 17,
    snapsPerMinor: 1,
    pixelsPerBaseUnit: 100,
    fixedSizeGrid: true,
  }

  it('removes floating-point tails from snapped coordinates', () => {
    expect(
      snapPointToGrid([8.2, 4.1], {
        ...options,
        majorGridSpacing: 2.7,
        minorGridsPerMajor: 2,
      })
    ).toEqual({ point: [8.1, 4.05], snapped: true })
  })

  it('preserves repeating subdivisions and is stable when snapped again', () => {
    const major = snapPointToGrid([2.34, -2.34], options)
    expect(major).toEqual({ point: [2.3333, -2.3333], snapped: true })

    const first = snapPointToGrid([0.1, -0.1], options)
    expect(first.snapped).toBe(true)
    expect(first.point[0]).toBeCloseTo(2.3333 / 17, 14)
    expect(first.point[1]).toBe(-first.point[0])

    // Nearest-grid choice on either side of the midpoint to the next line.
    expect(snapPointToGrid([0.2, -0.2], options)).toEqual(first)
    const second = snapPointToGrid([0.21, -0.21], options)
    expect(second.point[0]).toBeCloseTo((2.3333 * 2) / 17, 14)
    expect(second.point[1]).toBe(-second.point[0])
    for (const snapped of [major, first, second]) {
      expect(snapPointToGrid(snapped.point, options)).toEqual(snapped)
    }
  })

  it('preserves exact fractional coordinates on either side of the origin', () => {
    expect(
      snapPointToGrid([1.0078125, -1.0078125], {
        ...options,
        majorGridSpacing: 1,
        minorGridsPerMajor: 128,
      })
    ).toEqual({ point: [1.0078125, -1.0078125], snapped: true })
  })

  it('preserves binary grid fractions across subdivisions', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: 0, max: 10 }),
        (index, exponent) => {
          const divisions = 2 ** exponent
          const coordinate = index / divisions || 0
          const snapped = snapPointToGrid([coordinate, 0], {
            ...options,
            majorGridSpacing: 1,
            minorGridsPerMajor: divisions,
          })
          expect(snapped).toEqual({ point: [coordinate, 0], snapped: true })
          expect(
            snapPointToGrid(snapped.point, {
              ...options,
              majorGridSpacing: 1,
              minorGridsPerMajor: divisions,
            })
          ).toEqual(snapped)
        }
      )
    )
  })

  it('keeps extra digits when cleanup would select another grid point', () => {
    const coordinate = 100000000000000.12
    expect(
      snapPointToGrid([coordinate, -coordinate], {
        ...options,
        majorGridSpacing: 1,
        minorGridsPerMajor: 8,
      })
    ).toEqual({ point: [coordinate, -coordinate], snapped: true })
  })

  it('keeps very small grid coordinates distinct', () => {
    expect(
      snapPointToGrid([1e-8, -1e-8], {
        ...options,
        majorGridSpacing: 1e-8,
        minorGridsPerMajor: 1,
      })
    ).toEqual({ point: [1e-8, -1e-8], snapped: true })
  })

  it.each([NaN, Infinity, 1e20])('rejects unrepresentable cursor %s', (x) => {
    expect(snapPointToGrid([x, 1], options)).toEqual({
      point: [x, 1],
      snapped: false,
    })
  })

  it('normalizes negative zero', () => {
    expect(snapPointToGrid([-0.01, -0.01], options).point).toEqual([0, 0])
  })
})
