import { OrthographicCamera, PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'

import { ScaleGridRenderer } from '@src/clientSideScene/ScaleGridRenderer'

const options = {
  majorGridSpacing: 1,
  minorGridsPerMajor: 4,
  fixedSizeGrid: true,
  isLightTheme: false,
}

describe('ScaleGridRenderer', () => {
  it('keeps a fixed cell aligned with the file units when units change', () => {
    const camera = new OrthographicCamera(-50, 50, 50, -50, 0.1, 1000)
    camera.position.set(0, 0, 100)
    camera.lookAt(0, 0, 0)
    const grid = new ScaleGridRenderer()
    grid.updateScaleGrid(camera, [1000, 1000], 1, options)
    expect(grid.getPixelsPerBaseUnit(camera, [1000, 1000])).toBeCloseTo(10)
    grid.updateScaleGrid(camera, [1000, 1000], 25.4, options)
    expect(grid.getPixelsPerBaseUnit(camera, [1000, 1000])).toBeCloseTo(254)
    expect(grid.material.uniforms.uMajorSpacing.value).toBe(1)
  })

  it('keeps adaptive spacing visible after zooming out in perspective', () => {
    const camera = new PerspectiveCamera(45, 1, 0.1, 100000)
    camera.position.set(5000, 5000, 5000)
    camera.lookAt(0, 0, 0)
    const grid = new ScaleGridRenderer()
    grid.updateScaleGrid(camera, [1000, 1000], 1, {
      ...options,
      fixedSizeGrid: false,
    })
    expect(grid.visible).toBe(true)
    expect(grid.material.uniforms.uMajorSpacing.value).toBeGreaterThan(1)
    expect(grid.material.uniforms.uPerspective.value).toBe(true)
    expect(grid.name).toBe('ScaleGridRenderer')
  })
})
