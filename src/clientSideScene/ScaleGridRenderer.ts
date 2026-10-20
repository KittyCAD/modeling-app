import type { OrthographicCamera, PerspectiveCamera } from 'three'

import { InfiniteGridRenderer } from '@src/clientSideScene/InfiniteGridRenderer'
import { getGridScaleFactor } from '@src/clientSideScene/gridUtils'

export interface ScaleGridOptions {
  majorGridSpacing: number
  minorGridsPerMajor: number
  fixedSizeGrid: boolean
  isLightTheme: boolean
}

/** The engine's screen-space grid approach, rendered locally on the XY plane. */
export class ScaleGridRenderer extends InfiniteGridRenderer {
  constructor() {
    super()
    // Keep sketch snapping's lookup of InfiniteGridRenderer scoped to sketches.
    this.name = 'ScaleGridRenderer'
  }

  updateScaleGrid(
    camera: OrthographicCamera | PerspectiveCamera,
    viewportSize: [number, number],
    baseUnitMultiplier: number,
    options: ScaleGridOptions
  ) {
    this.scale.setScalar(baseUnitMultiplier)
    const pixelsPerBaseUnit = this.getPixelsPerBaseUnit(camera, viewportSize)
    const gridScaleFactor = getGridScaleFactor({
      ...options,
      pixelsPerBaseUnit,
    })
    const color = options.isLightTheme ? 0.25 : 0.8
    this.update(camera, pixelsPerBaseUnit, gridScaleFactor, {
      ...options,
      majorColor: [color, color, color, 0.3],
      minorColor: [color, color, color, 0.15],
    })
  }
}
