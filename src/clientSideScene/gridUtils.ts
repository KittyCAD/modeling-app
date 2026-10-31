import type { Coords2d } from '@src/lang/util'

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
    !Number.isSafeInteger(divisions) ||
    divisions <= 0
  ) {
    return { point, snapped: false }
  }

  const indices = point.map((coordinate) =>
    Math.round(coordinate / snapSpacing)
  )
  const coordinateAt = (index: number) => majorSpacing * (index / divisions)
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
