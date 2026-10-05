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
  const snapSpacing =
    (options.majorGridSpacing * gridScaleFactor) /
    (options.minorGridsPerMajor * options.snapsPerMinor)

  if (!Number.isFinite(snapSpacing) || snapSpacing <= 0) {
    return { point, snapped: false }
  }

  return {
    point: [
      Math.round(point[0] / snapSpacing) * snapSpacing,
      Math.round(point[1] / snapSpacing) * snapSpacing,
    ],
    snapped: true,
  }
}
