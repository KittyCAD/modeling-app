import { isArray } from '@src/lib/utils'
import { Mesh, PerspectiveCamera, Scene, type Vector2 } from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import {
  Line2NodeMaterial,
  MeshStandardNodeMaterial,
  type WebGPURenderer,
} from 'three/webgpu'
import { describe, expect, it, vi } from 'vitest'
import { IntegerIdPicker } from '@src/clientSideScene/localRenderer/IntegerIdPicker'

describe('IntegerIdPicker', () => {
  it('preserves visible body priority for targets and filtered occluders', async () => {
    const front = new Mesh(undefined, new MeshStandardNodeMaterial())
    const back = new Mesh(undefined, new MeshStandardNodeMaterial())
    back.material.polygonOffset = true
    back.material.polygonOffsetUnits = 4
    const model = new Scene()
    model.add(front, back)
    const render = vi.fn()
    const renderer = {
      getDrawingBufferSize: (size: Vector2) => size.set(10, 10),
      getRenderTarget: () => null,
      setRenderTarget: vi.fn(),
      render,
      readRenderTargetPixelsAsync: async () => new Uint32Array([1]),
    } as unknown as WebGPURenderer
    const picker = new IntegerIdPicker(renderer)
    picker.setTargets([front], model)
    await picker.pick({
      x: 5,
      y: 5,
      streamWidth: 10,
      streamHeight: 10,
      camera: new PerspectiveCamera(),
    })
    const scene: Scene = render.mock.calls[0][0]
    const proxies = scene.children.filter(
      (object): object is Mesh => object instanceof Mesh
    )
    expect(
      proxies.map(
        (proxy) =>
          (isArray(proxy.material) ? proxy.material[0] : proxy.material)
            .polygonOffsetUnits
      )
    ).toEqual([4, 0])
    picker.dispose()
  })

  it('accepts an edge source before its geometry has been populated', () => {
    const geometry = new LineSegmentsGeometry()
    const material = new Line2NodeMaterial()
    const source = new LineSegments2(geometry, material)
    const picker = new IntegerIdPicker({} as WebGPURenderer)

    // Three defaults instanceCount to Infinity until setPositions is called.
    expect(geometry.instanceCount).toBe(Infinity)
    expect(() =>
      picker.setTargets([], null, { source, targets: [] })
    ).not.toThrow()

    picker.dispose()
    geometry.dispose()
    material.dispose()
  })
})
