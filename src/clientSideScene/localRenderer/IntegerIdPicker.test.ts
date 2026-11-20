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

  it('reads a single grown ID and preserves sketch-line and face results', async () => {
    const ids = new Uint32Array(32 * 32).fill(1)
    ids[16 * 32 + 16] = 2 | selectionTypeTag(EdgeTargetType.BodyEdge)
    const readRenderTargetPixelsAsync = vi.fn(
      async (
        target: { texture: { name: string } },
        x: number,
        y: number,
        width: number,
        height: number
      ) => {
        expect(target.texture.name).toBe('local-renderer-grown-selection-ids')
        expect([width, height]).toEqual([1, 1])
        const pixels = new Uint32Array(width * height)
        for (let row = 0; row < height; row++) {
          for (let column = 0; column < width; column++) {
            pixels[row * width + column] = ids[(y + row) * 32 + x + column]
          }
        }
        return pixels
      }
    )
    const renderer = {
      backend: {},
      autoClear: true,
      domElement: { getBoundingClientRect: () => ({ width: 32, height: 32 }) },
      getDrawingBufferSize: (size: Vector2) => size.set(32, 32),
      getRenderTarget: () => null,
      setRenderTarget: vi.fn(),
      render: vi.fn(),
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
    const cursor = { x: 16, y: 16, streamWidth: 32, streamHeight: 32, camera }

    expect((await picker.pick(cursor))?.target).toBe(edge)
    ids[16 * 32 + 16] = 3 | selectionTypeTag(EdgeTargetType.SketchLine)
    picker.invalidate()
    expect((await picker.pick(cursor))?.target).toBe(sketchLine)
    ids[16 * 32 + 16] = 1
    picker.invalidate()
    expect((await picker.pick(cursor))?.target).toBe(face)
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
