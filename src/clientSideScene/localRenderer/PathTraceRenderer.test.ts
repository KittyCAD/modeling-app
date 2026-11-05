import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HalfFloatType, PerspectiveCamera, Texture, Vector2 } from 'three'
import type { WebGPURenderer } from 'three/webgpu'

const state = vi.hoisted(() => ({
  renderTime: 0,
  samples: 0,
  denoised: false,
  reset: vi.fn(),
  measure: vi.fn<() => Promise<{ min: number }>>(),
}))
vi.mock('oidn-web', () => ({
  initUNetFromURL: async () => ({ dispose: vi.fn() }),
}))
vi.mock('three-gpu-pathtracer/webgpu', () => ({
  OIDNDenoiser: class {
    get complete() {
      return state.denoised
    }
    setScene = vi.fn()
    dispose = vi.fn()
  },
  WebGPUPathTracer: class {
    maxSamples = 0
    reset = state.reset
    setScene = state.reset
    setCamera = state.reset
    updateCamera = state.reset
    setDenoiser = state.reset
    renderSample() {
      state.renderTime++
    }
    getRenderTime() {
      return state.renderTime
    }
    getSampleCountsAsync = state.measure
    dispose = vi.fn()
  },
}))
vi.mock('@src/lib/trap', () => ({ reportRejection: vi.fn() }))

import { PathTraceRenderer } from '@src/clientSideScene/localRenderer/PathTraceRenderer'

async function fixture() {
  let target: unknown = null
  const dimensions = new Vector2(100, 100)
  const gpu = {
    getRenderTarget: () => target,
    setRenderTarget: vi.fn((value) => {
      target = value
    }),
    getDrawingBufferSize: (size: Vector2) => size.copy(dimensions),
    getOutputBufferType: () => HalfFloatType,
    readRenderTargetPixelsAsync: async () => new Float32Array(512 * 256 * 4),
    render: vi.fn(),
  }
  const renderer = gpu as unknown as WebGPURenderer
  const tracer = await PathTraceRenderer.create(
    renderer,
    {} as GPUDevice,
    new Texture(),
    1,
    vi.fn()
  )
  tracer.setDenoise(false)
  return { tracer, renderer, gpu, dimensions, camera: new PerspectiveCamera() }
}

describe('stealth path tracing', () => {
  beforeEach(() => {
    state.renderTime = 0
    state.samples = 0
    state.denoised = false
    state.reset.mockImplementation(() => {
      state.renderTime = 0
      state.denoised = false
    })
    state.measure.mockImplementation(async () => ({ min: state.samples }))
  })

  it('keeps the real-time view until every pixel has converged', async () => {
    const { tracer, renderer, camera } = await fixture()
    expect(tracer.render(camera, renderer, true)).toBe(false)
    await Promise.resolve()
    state.samples = 10000
    expect(tracer.render(camera, renderer, true)).toBe(false)
    await Promise.resolve()
    expect(tracer.render(camera, renderer, true)).toBe(true)
    tracer.invalidateCamera()
    expect(tracer.settled).toBe(false)
    camera.position.x = 5
    camera.updateMatrixWorld()
    state.samples = 0
    expect(tracer.render(camera, renderer, true)).toBe(false)
    tracer.dispose()
  })

  it('waits for AI denoising before revealing the image', async () => {
    const { tracer, renderer, camera } = await fixture()
    tracer.setDenoise(true)
    state.samples = 10000
    expect(tracer.render(camera, renderer, true)).toBe(false)
    state.denoised = true
    expect(tracer.render(camera, renderer, true)).toBe(true)
    tracer.dispose()
  })

  it('hides the old denoised image immediately when resized', async () => {
    const { tracer, renderer, camera, dimensions } = await fixture()
    tracer.setDenoise(true)
    tracer.render(camera, renderer, true)
    state.denoised = true
    expect(tracer.render(camera, renderer, true)).toBe(true)
    dimensions.set(200, 150)
    expect(tracer.render(camera, renderer, true)).toBe(false)
    tracer.dispose()
  })

  it('renders the real-time view offscreen only while blending and restores the output target', async () => {
    const { tracer, renderer, camera } = await fixture()
    tracer.render(camera, renderer, false, false)
    const raster = vi.fn(() =>
      expect(renderer.getRenderTarget()).not.toBeNull()
    )
    tracer.present(renderer, 0.5, raster)
    expect(raster).toHaveBeenCalledOnce()
    expect(renderer.getRenderTarget()).toBeNull()
    tracer.present(renderer, 1, raster)
    expect(raster).toHaveBeenCalledOnce()
    tracer.dispose()
  })

  it('shows progressive samples immediately outside stealth mode', async () => {
    const { tracer, renderer, camera } = await fixture()
    expect(tracer.render(camera, renderer, false)).toBe(true)
    expect(tracer.settled).toBe(false)
    tracer.dispose()
  })

  it('ignores a converged sample count from an earlier camera', async () => {
    const { tracer, renderer, camera } = await fixture()
    let complete: ((value: { min: number }) => void) | undefined
    state.measure.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    tracer.render(camera, renderer, true)
    camera.position.x = 5
    camera.updateMatrixWorld()
    tracer.render(camera, renderer, true)
    complete?.({ min: 10000 })
    await Promise.resolve()
    expect(tracer.render(camera, renderer, true)).toBe(false)
    tracer.dispose()
  })
})
