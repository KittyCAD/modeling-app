import { OffsetPlaneRenderer } from '@src/clientSideScene/localRenderer/OffsetPlaneRenderer'
import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import { Color, Material, Mesh, Scene, SRGBColorSpace, Vector3 } from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { describe, expect, it, vi } from 'vitest'

function plane(id: string): Extract<Artifact, { type: 'plane' }> {
  return {
    type: 'plane',
    id,
    pathIds: [],
    codeRef: { range: [0, 1, 0], pathToNode: [], nodePath: { steps: [] } },
    planeInfo: {
      origin: { x: 10, y: -20, z: 30, units: 'mm' },
      xAxis: { x: 1, y: 0, z: 0, units: null },
      yAxis: { x: 0, y: 0, z: 1, units: null },
      zAxis: { x: 0, y: -1, z: 0, units: null },
    },
    size: 100,
  }
}

function fixture() {
  const scene = new Scene()
  const planes = new OffsetPlaneRenderer()
  planes.addTo(scene)
  planes.update(new Map([['plane', plane('plane')]]))
  return { scene, planes, root: scene.children[0] }
}

describe('OffsetPlaneRenderer', () => {
  it('renders only visible planes and follows hide/show changes after execution', () => {
    const { planes, root } = fixture()
    const artifacts: ArtifactGraph = new Map([
      ['offset', { ...plane('offset'), hidden: false }],
      ['sketch-support', { ...plane('sketch-support'), hidden: true }],
    ])
    planes.update(artifacts)
    expect(root.children.map((child) => child.name)).toEqual(['offset'])
    artifacts.set('offset', { ...plane('offset'), hidden: true })
    planes.update(artifacts)
    expect(root.children).toHaveLength(0)
    artifacts.set('offset', { ...plane('offset'), hidden: false })
    planes.update(artifacts)
    expect(root.children.map((child) => child.name)).toEqual(['offset'])
    planes.dispose()
  })

  it('renders the evaluated basis and mm origin in glTF coordinates', () => {
    const { scene, planes, root } = fixture()
    scene.updateMatrixWorld(true)
    const offsetPlane = root.children[0]
    const center = offsetPlane.getWorldPosition(new Vector3())
    expect(center.distanceTo(new Vector3(0.01, 0.03, 0.02))).toBeLessThan(1e-12)
    const x = new Vector3(1, 0, 0).transformDirection(offsetPlane.matrixWorld)
    const y = new Vector3(0, 1, 0).transformDirection(offsetPlane.matrixWorld)
    expect(x.distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-12)
    expect(y.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-12)
    expect(offsetPlane.name).toBe('plane')
    expect(offsetPlane.children).toHaveLength(2)
    planes.dispose()
  })

  it('matches the gray fill and opaque border, sharing resources across planes', () => {
    const { planes, root } = fixture()
    planes.update(
      new Map([
        ['a', plane('a')],
        ['b', plane('b')],
      ])
    )
    const [fill, border] = root.children[0].children
    const [secondFill, secondBorder] = root.children[1].children
    if (
      !(fill instanceof Mesh) ||
      !(fill.material instanceof MeshBasicNodeMaterial) ||
      !(border instanceof LineSegments2) ||
      !(secondFill instanceof Mesh) ||
      !(secondBorder instanceof LineSegments2)
    )
      throw new Error('Missing plane visuals')
    const gray = new Color().setRGB(0.6, 0.6, 0.6, SRGBColorSpace)
    expect(fill.material.color).toEqual(gray)
    expect(fill.material.opacity).toBe(0.3)
    expect(fill.material.transparent).toBe(true)
    expect(fill.material.depthWrite).toBe(false)
    expect(fill.material.toneMapped).toBe(false)
    expect(border.material.color).toEqual(gray)
    expect(border.material.linewidth).toBe(2)
    expect(border.material.transparent).toBe(false)
    expect(border.geometry.instanceCount).toBe(4)
    expect(secondFill.geometry).toBe(fill.geometry)
    expect(secondFill.material).toBe(fill.material)
    expect(secondBorder.geometry).toBe(border.geometry)
    expect(secondBorder.material).toBe(border.material)
    planes.dispose()
  })

  it('scales dimensions without moving the origin and respects fixed grid size', () => {
    const { planes, root, scene } = fixture()
    const offsetPlane = root.children[0]
    const cases: [number, number | undefined, number][] = [
      [100, undefined, 0.1],
      [1000, undefined, 1],
      [1000, 0.1, 0.01],
      [100, 0.1, 0.01],
    ]
    for (const [distance, fixedScale, expectedSizeMeters] of cases) {
      planes.updateScale(distance, fixedScale)
      scene.updateMatrixWorld(true)
      expect(
        offsetPlane
          .getWorldPosition(new Vector3())
          .distanceTo(new Vector3(0.01, 0.03, 0.02))
      ).toBeLessThan(1e-12)
      expect(
        offsetPlane.children[0].getWorldScale(new Vector3()).x
      ).toBeCloseTo(expectedSizeMeters, 12)
      expect(offsetPlane.children[1].scale).toEqual(
        offsetPlane.children[0].scale
      )
    }
    planes.dispose()
  })

  it('replaces and clears planes, skips absent transforms, and disposes shared resources once', () => {
    const { planes, root, scene } = fixture()
    const callbacks = new Set<ReturnType<typeof vi.fn>>()
    for (const child of root.children[0].children) {
      if (!(child instanceof Mesh) || !(child.material instanceof Material))
        throw new Error('Missing plane resources')
      for (const resource of [child.geometry, child.material]) {
        const callback = vi.fn()
        resource.addEventListener('dispose', callback)
        callbacks.add(callback)
      }
    }
    const artifacts: ArtifactGraph = new Map([
      ['new', { ...plane('new'), size: 200 }],
      ['face-support', { ...plane('face-support'), planeInfo: undefined }],
    ])
    planes.updateScale(100, 0.1)
    planes.update(artifacts)
    expect(root.children.map((child) => child.name)).toEqual(['new'])
    expect(root.children[0].children[0].scale.x).toBe(20)
    planes.update(new Map())
    expect(root.children).toHaveLength(0)
    for (const callback of callbacks) expect(callback).not.toHaveBeenCalled()
    planes.dispose()
    expect(scene.children).toHaveLength(0)
    for (const callback of callbacks) expect(callback).toHaveBeenCalledOnce()
  })
})
