import { IntegerIdPicker } from '@src/clientSideScene/localRenderer/IntegerIdPicker'
import { EdgeTargetType } from '@src/clientSideScene/localRenderer/EdgeRenderer'
import { selectionTypeTag } from '@src/clientSideScene/localRenderer/selectionId'
import { Mesh, PerspectiveCamera, type Vector2 } from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { Line2NodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { describe, expect, it, vi } from 'vitest'

describe('IntegerIdPicker', () => {
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
    edge.userData.type = EdgeTargetType.BodyEdge
    const sketchLine = new LineSegments2(geometry, material)
    sketchLine.userData.type = EdgeTargetType.SketchLine
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
