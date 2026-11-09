import type { Coords2d } from '@src/lang/util'
import { roundOff } from '@src/lib/utils'

const GRID_COORDINATE_DECIMALS = 6

export type GridSnapOptions = {
  majorGridSpacing: number
  minorGridsPerMajor: number
  snapsPerMinor: number
  pixelsPerBaseUnit: number
  fixedSizeGrid: boolean
}

// Returns the factor by which the configured grid spacing changes with zoom
// when the grid is not fixed-size.
export function getGridScaleFactor({
  majorGridSpacing,
  pixelsPerBaseUnit,
  fixedSizeGrid,
}: Pick<
  GridSnapOptions,
  'majorGridSpacing' | 'pixelsPerBaseUnit' | 'fixedSizeGrid'
>) {
  if (fixedSizeGrid) {
    return 1
  }

  const majorSpacingPixels = majorGridSpacing * pixelsPerBaseUnit
  if (majorSpacingPixels <= 0) {
    return 1
  }

  const minimumMajorSpacingPixels = 40
  const maximumMajorSpacingPixels = minimumMajorSpacingPixels * 10

  if (majorSpacingPixels < minimumMajorSpacingPixels) {
    return (
      10 **
      Math.ceil(Math.log10(minimumMajorSpacingPixels / majorSpacingPixels))
    )
  }

  if (majorSpacingPixels > maximumMajorSpacingPixels) {
    return (
      1 /
      10 **
        Math.ceil(Math.log10(majorSpacingPixels / maximumMajorSpacingPixels))
    )
  }

  return 1
}

export function snapPointToGrid(
  point: Coords2d,
  options: GridSnapOptions
): { point: Coords2d; snapped: boolean } {
  const gridScaleFactor = getGridScaleFactor(options)
  const majorSpacing = options.majorGridSpacing * gridScaleFactor
  const divisions = options.minorGridsPerMajor * options.snapsPerMinor
  const snapSpacing = majorSpacing / divisions

  if (
    !Number.isFinite(snapSpacing) ||
    snapSpacing <= 0 ||
    !Number.isFinite(divisions) ||
    divisions <= 0
  ) {
    return { point, snapped: false }
  }

  const indices = point.map((coordinate) =>
    Math.round(coordinate / snapSpacing)
  )
  // Normalize before creating the snap candidate so previews, drawing, and
  // dragging all use the same coordinate without floating-point tails in KCL.
  const coordinateAt = (index: number) => {
    const coordinate = majorSpacing * (index / divisions)
    const rounded = roundOff(coordinate, GRID_COORDINATE_DECIMALS)
    // Keep fine grids working when rounding would select a different grid point.
    return Math.round(rounded / snapSpacing) === index ? rounded : coordinate
  }
  // Adjacent grid locations must remain distinguishable at this magnitude.
  if (
    indices.some(
      (index) =>
        !Number.isSafeInteger(index) ||
        !Number.isFinite(coordinateAt(index)) ||
        Math.round(coordinateAt(index) / snapSpacing) !== index ||
        coordinateAt(index - 1) === coordinateAt(index) ||
        coordinateAt(index + 1) === coordinateAt(index)
    )
  ) {
    return { point, snapped: false }
  }

  return {
    point: [coordinateAt(indices[0]) || 0, coordinateAt(indices[1]) || 0],
    snapped: true,
  }
}
