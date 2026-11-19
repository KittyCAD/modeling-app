import { BoxGeometry, Mesh, PerspectiveCamera } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { Line2NodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { ModelVisibilityMask } from '@src/clientSideScene/localRenderer/ModelVisibilityMask'

function fixture() {
  const pixels = new Uint8Array(64 * 64 * 4)
  const renderer = {
    autoClear: false,
    getRenderTarget: vi.fn(() => null),
    setRenderTarget: vi.fn(),
    render: vi.fn<WebGPURenderer['render']>(),
    readRenderTargetPixelsAsync: vi.fn<
      WebGPURenderer['readRenderTargetPixelsAsync']
    >(async () => pixels),
  }
  const mask = new ModelVisibilityMask(renderer)
  const geometry = new BoxGeometry()
  mask.setModel(new Mesh(geometry))
  return { pixels, renderer, mask, geometry }
}

describe('model silhouette coverage', () => {
  it('counts model pixels rather than opaque background pixels and restores render state', async () => {
    const { pixels, renderer, mask, geometry } = fixture()
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255
    expect(await mask.coverage(new PerspectiveCamera())).toBe(0)
    for (let i = 0; i < pixels.length; i += 8) pixels[i] = 255
    expect(await mask.coverage(new PerspectiveCamera())).toBe(0.5)
    expect(renderer.autoClear).toBe(false)
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null)
    const disposeGeometry = vi.spyOn(geometry, 'dispose')
    await mask.dispose()
    expect(disposeGeometry).not.toHaveBeenCalled()
    geometry.dispose()
  })

  it('includes standalone curves and follows their current visibility', async () => {
    const { renderer, mask, geometry } = fixture()
    const lineGeometry = new LineSegmentsGeometry().setPositions([
      -1, 0, 0, 1, 0, 0,
    ])
    const material = new Line2NodeMaterial()
    const line = new LineSegments2(lineGeometry, material)
    line.visible = false
    mask.setModel(line)
    await mask.coverage(new PerspectiveCamera())
    const scene = renderer.render.mock.calls[0][0]
    const proxy = scene.children[0]
    expect(proxy).toBeInstanceOf(LineSegments2)
    expect(proxy.visible).toBe(false)
    line.visible = true
    await mask.coverage(new PerspectiveCamera())
    expect(proxy.visible).toBe(true)
    await mask.dispose()
    lineGeometry.dispose()
    material.dispose()
    geometry.dispose()
  })

  it('waits for a pending GPU read before disposing its target', async () => {
    const { pixels, renderer, mask, geometry } = fixture()
    let finish = () => {}
    renderer.readRenderTargetPixelsAsync.mockImplementation(
      () =>
        new Promise<typeof pixels>((resolve) => {
          finish = () => resolve(pixels)
        })
    )
    const coverage = mask.coverage(new PerspectiveCamera())
    const target = renderer.readRenderTargetPixelsAsync.mock.calls[0][0]
    const disposeTarget = vi.spyOn(target, 'dispose')
    const disposal = mask.dispose()
    await Promise.resolve()
    expect(disposeTarget).not.toHaveBeenCalled()
    finish()
    await disposal
    expect(disposeTarget).toHaveBeenCalledOnce()
    expect(await coverage).toBeUndefined()
    geometry.dispose()
  })

  it('restores the scene renderer even if the mask draw fails', async () => {
    const { renderer, mask, geometry } = fixture()
    renderer.render.mockImplementation(() => {
      throw new Error('draw failed')
    })
    await expect(mask.coverage(new PerspectiveCamera())).rejects.toThrow(
      'draw failed'
    )
    expect(renderer.autoClear).toBe(false)
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null)
    await mask.dispose()
    geometry.dispose()
  })
})
