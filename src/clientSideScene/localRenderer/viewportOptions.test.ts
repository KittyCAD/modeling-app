import { Group, Mesh, MeshStandardMaterial } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCAL_VIEWPORT_OPTIONS,
  ViewportAppearance,
  getViewportPixelRatio,
  isVisibleInViewport,
} from '@src/clientSideScene/localRenderer/viewportOptions'

describe('viewport resolution', () => {
  it('supersamples relative to the display pixel density', () => {
    expect(getViewportPixelRatio(1280, 720, 1.5, 1, 8192)).toBe(1.5)
    expect(getViewportPixelRatio(1280, 720, 1.5, 1.5, 8192)).toBe(2.25)
    expect(getViewportPixelRatio(1280, 720, 1.5, 2, 8192)).toBe(3)
  })

  it('limits large viewports by texture dimensions and total buffer area', () => {
    const ultrawide = getViewportPixelRatio(5000, 500, 2, 2, 8192)
    expect(5000 * ultrawide).toBeLessThanOrEqual(8192)
    const large = getViewportPixelRatio(3840, 2160, 2, 2, 8192)
    expect(
      Math.floor(3840 * large) * Math.floor(2160 * large)
    ).toBeLessThanOrEqual(16_777_216)
    expect(getViewportPixelRatio(1280, 720, 2, 2, 2048)).toBe(1.6)
  })
})

describe('viewport appearance', () => {
  it.each([MeshStandardMaterial, MeshStandardNodeMaterial])(
    'restores imported materials without accumulating opacity changes (%s)',
    (Material) => {
      const material = new Material({
        opacity: 0.6,
        transparent: true,
        depthWrite: false,
      })
      const mesh = new Mesh(undefined, material)
      const appearance = new ViewportAppearance()
      const options = {
        ...DEFAULT_LOCAL_VIEWPORT_OPTIONS,
        opacity: 50,
        style: 'wireframe' as const,
      }
      appearance.apply(mesh, options)
      appearance.apply(mesh, options)
      expect(material.opacity).toBe(0.3)
      expect(material.wireframe).toBe(true)
      appearance.apply(mesh, { ...options, style: 'faceted' })
      expect(material.wireframe).toBe(false)
      expect(material.flatShading).toBe(true)
      appearance.apply(mesh, DEFAULT_LOCAL_VIEWPORT_OPTIONS)
      expect(material.opacity).toBe(0.6)
      expect(material.transparent).toBe(true)
      expect(material.depthWrite).toBe(false)
      expect(material.flatShading).toBe(false)
    }
  )

  it('keeps imported mesh geometry and sketch visibility independent of B-reps', () => {
    const model = new Group()
    const body = new Mesh()
    body.userData.isBrep = true
    const importedMesh = new Mesh()
    const sketch = new Mesh()
    sketch.userData.isSketchRegion = true
    const alreadyHidden = new Mesh()
    alreadyHidden.visible = false
    model.add(body, importedMesh, sketch, alreadyHidden)
    const appearance = new ViewportAppearance()
    appearance.apply(model, {
      ...DEFAULT_LOCAL_VIEWPORT_OPTIONS,
      showBreps: false,
    })
    expect(body.visible).toBe(false)
    expect(importedMesh.visible).toBe(true)
    expect(sketch.visible).toBe(true)
    appearance.apply(model, {
      ...DEFAULT_LOCAL_VIEWPORT_OPTIONS,
      showSketches: false,
    })
    expect(body.visible).toBe(true)
    expect(sketch.visible).toBe(false)
    expect(alreadyHidden.visible).toBe(false)
    model.visible = false
    expect(isVisibleInViewport(body)).toBe(false)
  })
})
