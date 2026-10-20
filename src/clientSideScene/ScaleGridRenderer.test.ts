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
  it('fades fixed-size minor lines over a range of zoom levels', () => {
    const camera = new OrthographicCamera(-50, 50, 50, -50, 0.1, 1000)
    camera.position.set(0, 0, 100)
    camera.lookAt(0, 0, 0)
    const grid = new ScaleGridRenderer()
    grid.updateScaleGrid(camera, [1000, 1000], 1, options)
    expect(grid.material.uniforms.uMinorOpacity.value).toBe(0)
    camera.zoom = 3
    grid.updateScaleGrid(camera, [1000, 1000], 1, options)
    expect(grid.material.uniforms.uMinorOpacity.value).toBeGreaterThan(0)
    expect(grid.material.uniforms.uMinorOpacity.value).toBeLessThan(1)
    camera.zoom = 5
    grid.updateScaleGrid(camera, [1000, 1000], 1, options)
    expect(grid.material.uniforms.uMinorOpacity.value).toBe(1)
    expect(grid.material.uniforms.uMinorSpacing.value).toBe(0.25)
  })

  it('keeps shared grid lines visible across an adaptive scale boundary', () => {
    const camera = new OrthographicCamera(-50, 50, 50, -50, 0.1, 1000)
    camera.position.set(0, 0, 100)
    camera.lookAt(0, 0, 0)
    const grid = new ScaleGridRenderer()
    const sharedLevelWeights = [3.9999, 4.0001].map((zoom) => {
      camera.zoom = zoom
      grid.updateScaleGrid(camera, [1000, 1000], 1, {
        ...options,
        fixedSizeGrid: false,
      })
      const uniforms = grid.material.uniforms
      const spacing = uniforms.uMajorSpacing.value
      return spacing === 1
        ? 1 - uniforms.uGridLevelBlend.value
        : uniforms.uGridLevelBlend.value
    })
    expect(sharedLevelWeights[0]).toBeCloseTo(1)
    expect(sharedLevelWeights[1]).toBeCloseTo(1)
  })

  it('keeps the fade at the same world distance when file units change', () => {
    const camera = new OrthographicCamera(-50, 50, 50, -50, 0.1, 1000)
    camera.position.set(0, 0, 100)
    camera.lookAt(0, 0, 0)
    const grid = new ScaleGridRenderer()
    grid.updateScaleGrid(camera, [1000, 1000], 1, options)
    const startMm = grid.material.uniforms.uFadeStart.value
    const endMm = grid.material.uniforms.uFadeEnd.value
    grid.updateScaleGrid(camera, [1000, 1000], 25.4, options)
    expect(grid.material.uniforms.uFadeStart.value * 25.4).toBeCloseTo(startMm)
    expect(grid.material.uniforms.uFadeEnd.value * 25.4).toBeCloseTo(endMm)
    expect(endMm).toBeGreaterThan(startMm)
    expect(startMm).toBeGreaterThan(0)
  })

  it('fades dense cells smoothly and draws colored world axes', () => {
    const grid = new ScaleGridRenderer()
    expect(grid.material.uniforms.uFadeDenseGrid.value).toBe(true)
    expect(grid.material.uniforms.uShowAxes.value).toBe(true)
    expect(grid.material.uniforms.uXAxisColor.value).toEqual([
      220 / 255,
      2 / 255,
      31 / 255,
      0.9,
    ])
    expect(grid.material.uniforms.uYAxisColor.value).toEqual([
      22 / 255,
      202 / 255,
      51 / 255,
      0.9,
    ])
    expect(grid.material.transparent).toBe(true)
    expect(grid.material.alphaToCoverage).toBe(false)
  })

  it('retains the axes when fixed-size grid cells become too dense', () => {
    const camera = new OrthographicCamera(-5000, 5000, 5000, -5000, 0.1, 1000)
    camera.position.set(0, 0, 100)
    camera.lookAt(0, 0, 0)
    const grid = new ScaleGridRenderer()
    grid.updateScaleGrid(camera, [1000, 1000], 1, options)
    expect(grid.visible).toBe(true)
    expect(grid.material.uniforms.uMajorSpacing.value).toBe(1)
  })

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
