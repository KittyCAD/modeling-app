import { isArray } from '@src/lib/utils'
import { Color, Mesh, PerspectiveCamera, Scene, type Vector2 } from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import {
  Line2NodeMaterial,
  MeshStandardNodeMaterial,
  type WebGPURenderer,
} from 'three/webgpu'
import { describe, expect, it, vi } from 'vitest'
import { createPlaneMaterials } from '@src/clientSideScene/localRenderer/planeMaterials'
import { IntegerIdPicker } from '@src/clientSideScene/localRenderer/IntegerIdPicker'
import {
  EdgeTargetType,
  selectionTypeTag,
} from '@src/clientSideScene/localRenderer/selectionId'

describe('IntegerIdPicker', () => {
  it('preserves visible body priority for targets and filtered occluders', async () => {
    const front = new Mesh(undefined, new MeshStandardNodeMaterial())
    const back = new Mesh(undefined, new MeshStandardNodeMaterial())
    back.material.polygonOffset = true
    back.material.polygonOffsetUnits = 4
    back.material.polygonOffsetFactor = 1 / 256
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
    expect(
      proxies.map(
        (proxy) =>
          (isArray(proxy.material) ? proxy.material[0] : proxy.material)
            .polygonOffsetFactor
      )
    ).toEqual([1 / 256, 0])
    picker.dispose()
  })

  it.each([false, true])(
    'keeps sketch picking ahead of visible reference planes (filtered: %s)',
    async (filtered) => {
      const plane = new Mesh(
        undefined,
        createPlaneMaterials(new Color(1, 0, 0), 0.1).fillMaterial
      )
      const region = new Mesh(undefined, new MeshStandardNodeMaterial())
      region.userData.isSketchRegion = true
      const geometry = new LineSegmentsGeometry()
      geometry.setPositions([0, 0, 0, 1, 0, 0])
      const lines = new LineSegments2(geometry, new Line2NodeMaterial())
      const render = vi.fn()
      const renderer = {
        domElement: {
          getBoundingClientRect: () => ({ width: 10, height: 10 }),
        },
        getDrawingBufferSize: (size: Vector2) => size.set(10, 10),
        getRenderTarget: () => null,
        setRenderTarget: vi.fn(),
        render,
        readRenderTargetPixelsAsync: async () => new Uint32Array([1]),
      } as unknown as WebGPURenderer
      const picker = new IntegerIdPicker(renderer)
      picker.setTargets(
        filtered ? [region] : [plane, region],
        plane,
        undefined,
        {
          source: lines,
          targets: [
            { object: lines, ranges: [{ firstSegment: 0, segmentCount: 1 }] },
          ],
        }
      )
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
      const materials = proxies.map((proxy) =>
        isArray(proxy.material) ? proxy.material[0] : proxy.material
      )
      expect(materials).toHaveLength(3)
      const [planeMaterial, regionMaterial, lineMaterial] = materials
      for (const property of [
        'polygonOffsetFactor',
        'polygonOffsetUnits',
      ] as const) {
        expect(regionMaterial[property]).toBeLessThan(planeMaterial[property])
        expect(lineMaterial[property]).toBeLessThan(regionMaterial[property])
      }
      picker.dispose()
      geometry.dispose()
      lines.material.dispose()
      plane.material.dispose()
      region.material.dispose()
    }
  )

  it('reads one cursor pixel from the active ID buffer and resolves its target', async () => {
    // Supply the GPU output: this exercises readback and ID decoding, not the growth shader.
    let grownId = 2 | selectionTypeTag(EdgeTargetType.BodyEdge)
    const sketchId = 3 | selectionTypeTag(EdgeTargetType.SketchLine)
    const readRenderTargetPixelsAsync = vi.fn(
      async (
        target: { texture: { name: string } },
        x: number,
        y: number,
        width: number,
        height: number
      ) => {
        expect([x, y, width, height]).toEqual([9, 17, 1, 1])
        return Uint32Array.of(
          target.texture.name === 'local-renderer-grown-selection-ids'
            ? grownId
            : 1
        )
      }
    )
    const render = vi.fn()
    const renderer = {
      backend: {},
      autoClear: true,
      domElement: { getBoundingClientRect: () => ({ width: 32, height: 32 }) },
      getDrawingBufferSize: (size: Vector2) => size.set(32, 32),
      getRenderTarget: () => null,
      setRenderTarget: vi.fn(),
      render,
      readRenderTargetPixelsAsync,
    } as unknown as WebGPURenderer
    const face = new Mesh()
    const geometry = new LineSegmentsGeometry().setPositions([0, 0, 0, 1, 0, 0])
    const material = new Line2NodeMaterial()
    const edge = new LineSegments2(geometry, material)
    const sketchLine = new LineSegments2(geometry, material)
    const picker = new IntegerIdPicker(renderer)
    picker.setTargets(
      [face],
      null,
      { source: edge, targets: [{ object: edge, ranges: [] }] },
      { source: sketchLine, targets: [{ object: sketchLine, ranges: [] }] }
    )
    const camera = new PerspectiveCamera()
    const cursor = { x: 9, y: 17, streamWidth: 32, streamHeight: 32, camera }

    expect((await picker.pick(cursor))?.target).toBe(edge)
    grownId = sketchId
    picker.setEdgesVisible(false)
    expect((await picker.pick(cursor))?.target).toBe(sketchLine)
    render.mockClear()
    sketchLine.visible = false
    picker.invalidate()
    expect((await picker.pick(cursor))?.target).toBe(face)
    expect(render).toHaveBeenCalledTimes(1)
    expect(readRenderTargetPixelsAsync).toHaveBeenCalledTimes(3)

    picker.dispose()
    geometry.dispose()
    material.dispose()
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
