import type { OrthographicCamera, PerspectiveCamera } from 'three'
import { MathUtils } from 'three'

import { InfiniteGridRenderer } from '@src/clientSideScene/InfiniteGridRenderer'

export interface ScaleGridOptions {
  majorGridSpacing: number
  minorGridsPerMajor: number
  fixedSizeGrid: boolean
  isLightTheme: boolean
}

/** The engine's screen-space grid approach, rendered locally on the XY plane. */
export class ScaleGridRenderer extends InfiniteGridRenderer {
  constructor() {
    super({ fadeDenseGrid: true, showAxes: true })
    // Alpha-to-coverage quantizes low opacity into a few MSAA samples. Use
    // blending for a continuous fade all the way to a transparent horizon.
    this.material.transparent = true
    this.material.alphaToCoverage = false
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
    // Anchor the fade to the world origin and let its radius follow zoom.
    // Keep the central working area at full strength.
    const viewportSpan =
      Math.min(...viewportSize) / window.devicePixelRatio / pixelsPerBaseUnit
    this.material.uniforms.uFadeStart.value = viewportSpan * 0.35
    this.material.uniforms.uFadeEnd.value = viewportSpan * 0.9
    const spacingPixels = options.majorGridSpacing * pixelsPerBaseUnit
    const level =
      !options.fixedSizeGrid && spacingPixels > 0
        ? Math.log10(40 / spacingPixels)
        : 0
    const exponent = Math.floor(level)
    const gridScaleFactor = options.fixedSizeGrid ? 1 : 10 ** exponent
    const color = options.isLightTheme ? 0.25 : 0.8
    this.update(camera, pixelsPerBaseUnit, gridScaleFactor, {
      ...options,
      majorColor: [color, color, color, 0.3],
      minorColor: [color, color, color, 0.15],
    })
    const uniforms = this.material.uniforms
    uniforms.uGridLevelBlend.value = options.fixedSizeGrid
      ? 0
      : MathUtils.smoothstep(level - exponent, 0, 1)
    // Also fade fixed-size minor lines over a range of projected sizes.
    const minorPixels = uniforms.uMinorSpacing.value * pixelsPerBaseUnit
    uniforms.uMinorOpacity.value = MathUtils.smoothstep(minorPixels, 3, 12)
    uniforms.uNextMinorOpacity.value = MathUtils.smoothstep(
      minorPixels * 10,
      3,
      12
    )
  }
}
