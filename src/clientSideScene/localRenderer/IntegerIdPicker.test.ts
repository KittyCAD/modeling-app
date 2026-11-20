import { IntegerIdPicker } from '@src/clientSideScene/localRenderer/IntegerIdPicker'
import {
  EdgeTargetType,
  selectionTypeTag,
} from '@src/clientSideScene/localRenderer/selectionId'
import { Mesh, PerspectiveCamera, type Vector2 } from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { Line2NodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { describe, expect, it, vi } from 'vitest'

describe('IntegerIdPicker', () => {
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
