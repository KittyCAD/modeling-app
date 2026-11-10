import { PlaneRenderer } from '@src/clientSideScene/localRenderer/PlaneRenderer'
import type { Artifact } from '@src/lang/wasm'
import { Themes } from '@src/lib/theme'
import { Color, Material, Mesh, Scene, SRGBColorSpace, Vector3 } from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('PlaneRenderer default planes', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      function (this: HTMLCanvasElement) {
        return {
          canvas: this,
          measureText: (text: string) => ({ width: text.length * 14 }),
          scale: vi.fn(),
          fillRect: vi.fn(),
          fillText: vi.fn(),
        } as unknown as CanvasRenderingContext2D
      }
    )
  })
  afterEach(() => vi.restoreAllMocks())

  function fixture() {
    const scene = new Scene()
    const planes = new PlaneRenderer(Themes.Light)
    planes.updateDefaultPlanes({
      xy: 'plane-xy',
      yz: 'plane-yz',
      xz: 'plane-xz',
    })
    planes.addTo(scene)
    return { scene, planes, root: scene.children[0] }
  }

  it('populates IDs when available and rekeys defaults without recreating their visuals', () => {
    const planes = new PlaneRenderer(Themes.Light)
    planes.updateDefaultPlanes(null)
    expect(planes.planes.size).toBe(0)
    planes.updateDefaultPlanes({ xy: 'xy-1', yz: 'yz-1', xz: 'xz-1' })
    const originals = [...planes.planes.values()]
    planes.updateDefaultPlanes({ xy: 'xy-2', yz: 'yz-2', xz: 'xz-2' })
    expect([...planes.planes.keys()]).toEqual(['xy-2', 'yz-2', 'xz-2'])
    expect([...planes.planes.values()]).toEqual(originals)
    expect(originals.map(({ mesh }) => mesh.name)).toEqual([
      'xy-2',
      'yz-2',
      'xz-2',
    ])
    planes.dispose()
  })

  it('replaces only offset planes, sharing geometry and keeping defaults and labels intact', () => {
    const { planes } = fixture()
    const defaults = [...planes.planes.values()]
    const offset: Artifact = {
      type: 'plane',
      id: 'offset',
      pathIds: [],
      codeRef: { range: [0, 1, 0], pathToNode: [], nodePath: { steps: [] } },
      planeInfo: {
        origin: { x: 0, y: 0, z: 20, units: 'mm' },
        xAxis: { x: 1, y: 0, z: 0, units: null },
        yAxis: { x: 0, y: 1, z: 0, units: null },
        zAxis: { x: 0, y: 0, z: 1, units: null },
      },
      size: 100,
    }
    planes.setDefaultVisibility({ xy: false, yz: true, xz: true })
    planes.updateOffsetPlanes(new Map([['offset', offset]]))
    const oldOffset = planes.planes.get('offset')
    expect(oldOffset?.mesh.geometry).toBe(defaults[0].mesh.geometry)
    expect(oldOffset?.group.visible).toBe(true)
    const dispose = vi.spyOn(defaults[0].mesh.geometry, 'dispose')
    planes.updateOffsetPlanes(new Map([['offset', offset]]))
    expect(planes.planes.get('offset')).not.toBe(oldOffset)
    expect(oldOffset?.group.parent).toBeNull()
    planes.updateOffsetPlanes(new Map())
    expect([...planes.planes.values()]).toEqual(defaults)
    expect(defaults[0].group.visible).toBe(false)
    expect(defaults[0].group.children).toHaveLength(4)
    expect(dispose).not.toHaveBeenCalled()
    planes.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('creates the three labeled planes at the origin in glTF coordinates', () => {
    const { scene, root, planes } = fixture()
    expect(root.children.map((child) => child.name)).toEqual(['XY', 'YZ', 'XZ'])
    scene.updateMatrixWorld(true)
    const expectedAxes = [
      [new Vector3(1, 0, 0), new Vector3(0, 0, -1)],
      [new Vector3(0, 0, -1), new Vector3(0, 1, 0)],
      [new Vector3(1, 0, 0), new Vector3(0, 1, 0)],
    ]
    root.children.forEach((plane, index) => {
      const x = new Vector3(1, 0, 0).transformDirection(plane.matrixWorld)
      const y = new Vector3(0, 1, 0).transformDirection(plane.matrixWorld)
      expect(x.distanceTo(expectedAxes[index][0])).toBeLessThan(1e-12)
      expect(y.distanceTo(expectedAxes[index][1])).toBeLessThan(1e-12)
      expect(plane.position.length()).toBe(0)
    })
    expect(
      root.children.map((plane) =>
        plane.children.slice(2).map((label) => label.name)
      )
    ).toEqual([
      ['XY', 'Top'],
      ['YZ', 'Side'],
      ['XZ', 'Front'],
    ])
    planes.dispose()
  })

  it('uses translucent fills and depth-writing opaque borders and labels', () => {
    const { root, planes } = fixture()
    const colors = [
      new Color().setRGB(0.7, 0.28, 0.28, SRGBColorSpace),
      new Color().setRGB(0.28, 0.7, 0.28, SRGBColorSpace),
      new Color().setRGB(0.28, 0.28, 0.7, SRGBColorSpace),
    ]
    const borderColors = [
      new Color().setRGB(0.7, 0.42, 0.42, SRGBColorSpace),
      new Color().setRGB(0.42, 0.7, 0.42, SRGBColorSpace),
      new Color().setRGB(0.42, 0.42, 0.7, SRGBColorSpace),
    ]
    root.children.forEach((plane, index) => {
      const fill = plane.children[0]
      const border = plane.children[1]
      expect(fill).toBeInstanceOf(Mesh)
      expect(border).toBeInstanceOf(LineSegments2)
      if (
        !(fill instanceof Mesh) ||
        !(fill.material instanceof MeshBasicNodeMaterial) ||
        !(border instanceof LineSegments2)
      ) {
        throw new Error('Missing plane geometry')
      }
      expect(fill.material.color).toEqual(colors[index])
      expect(fill.material.opacity).toBe(0.1)
      expect(fill.material.depthTest).toBe(true)
      expect(fill.material.depthWrite).toBe(false)
      expect(fill.material.forceSinglePass).toBe(true)
      expect(fill.material.toneMapped).toBe(false)
      border.material.color.toArray().forEach((channel, i) => {
        expect(channel).toBeCloseTo(borderColors[index].toArray()[i], 12)
      })
      expect(border.material.linewidth).toBe(2)
      expect(border.material.transparent).toBe(false)
      expect(border.material.depthTest).toBe(true)
      expect(border.material.depthWrite).toBe(true)
      for (const label of plane.children.slice(2)) {
        if (!(label instanceof Mesh) || !(label.material instanceof Material))
          throw new Error('Missing plane label')
        expect(label.material.transparent).toBe(false)
        expect(label.material.depthTest).toBe(true)
        expect(label.material.depthWrite).toBe(true)
      }
      expect(border.geometry.instanceCount).toBe(4)
      const starts = border.geometry.getAttribute('instanceStart')
      const ends = border.geometry.getAttribute('instanceEnd')
      for (let i = 0; i < starts.count; i++) {
        const start = new Vector3().fromBufferAttribute(starts, i)
        const end = new Vector3().fromBufferAttribute(ends, i)
        expect(start.distanceTo(end)).toBe(100)
        expect(start.z).toBe(0)
        expect(end.z).toBe(0)
      }
    })
    planes.dispose()
  })

  it('hides each entire plane, including its border and labels, without rebuilding it', () => {
    const { root, planes } = fixture()
    const originalPlanes = [...root.children]
    const visibleNames = () => {
      const names: string[] = []
      root.traverseVisible((object) => names.push(object.name))
      return names
    }

    planes.setDefaultVisibility({ xy: false, yz: true, xz: false })
    expect(visibleNames()).toEqual([
      'reference-planes',
      'YZ',
      'plane-yz',
      'YZ-border',
      'YZ',
      'Side',
    ])
    planes.setDefaultVisibility({ xy: false, yz: false, xz: false })
    expect(visibleNames()).toEqual(['reference-planes'])
    planes.setDefaultVisibility({ xy: true, yz: false, xz: true })
    expect(root.children.map((plane) => plane.visible)).toEqual([
      true,
      false,
      true,
    ])
    expect(visibleNames()).toContain('Top')
    expect(visibleNames()).toContain('Front')
    expect(visibleNames()).not.toContain('Side')
    expect(root.children).toEqual(originalPlanes)
    planes.dispose()
  })

  it.each([
    [0.1, 0.000001],
    [1, 0.00001],
    [10, 0.0001],
    [100, 0.001],
    [1000, 0.01],
    [10000, 0.1],
    [100000, 1],
  ])(
    'scales with camera distance %s mm without rebuilding geometry',
    (distance, scale) => {
      const { planes, root } = fixture()
      const originalChildren = [...root.children]
      planes.updateScale(distance)
      root.updateMatrixWorld(true)
      expect(root.children[0].getWorldScale(new Vector3()).x).toBeCloseTo(
        scale,
        12
      )
      expect(root.children).toEqual(originalChildren)
      planes.dispose()
    }
  )

  it.each([0.1, 1, 2.54])(
    'keeps fixed grid scale %s independent of zoom',
    (fixedGridScale) => {
      const { planes, root } = fixture()
      for (const distance of [1, 100, 10000]) {
        planes.updateScale(distance, fixedGridScale)
        root.updateMatrixWorld(true)
        expect(root.children[0].getWorldScale(new Vector3()).x).toBeCloseTo(
          fixedGridScale / 1000,
          12
        )
      }
      planes.updateScale(1000)
      root.updateMatrixWorld(true)
      expect(root.children[0].getWorldScale(new Vector3()).x).toBe(0.01)
      planes.dispose()
    }
  )

  it('disposes shared geometry, materials, and label textures once', () => {
    const { planes, scene } = fixture()
    const disposeCallbacks = new Map<object, ReturnType<typeof vi.fn>>()
    scene.traverse((object) => {
      if (!(object instanceof Mesh) || !(object.material instanceof Material))
        return
      const resources = [object.geometry, object.material]
      if (
        object.material instanceof MeshBasicNodeMaterial &&
        object.material.map
      )
        resources.push(object.material.map)
      for (const resource of resources) {
        if (disposeCallbacks.has(resource)) continue
        const disposed = vi.fn()
        resource.addEventListener('dispose', disposed)
        disposeCallbacks.set(resource, disposed)
      }
    })
    planes.dispose()
    expect(scene.children).toHaveLength(0)
    for (const disposed of disposeCallbacks.values())
      expect(disposed).toHaveBeenCalledTimes(1)
  })
})
