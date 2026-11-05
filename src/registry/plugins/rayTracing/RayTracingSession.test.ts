import { EdgeRenderer } from '@src/clientSideScene/localRenderer/EdgeRenderer'
import { signal } from '@preact/signals-core'
import type { SceneRenderFrame } from '@src/clientSideScene/localRenderer/renderExtension'
import { PerspectiveCamera } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultRayTracingOptions } from './runtime'

vi.mock('./PathTraceRenderer', () => ({
  PathTraceRenderer: { create: vi.fn() },
}))
import { RayTracingSession } from './RayTracingSession'

function fixture() {
  const options = signal({ ...defaultRayTracingOptions })
  const tracer = {
    setModel: vi.fn(),
    setDenoise: vi.fn(),
    setDenoiseFadeDuration: vi.fn(),
    invalidateCamera: vi.fn(),
    settled: false,
    render: vi.fn().mockReturnValue(false),
    renderEdges: vi.fn(),
    present: vi.fn(),
    dispose: vi.fn(),
  }
  const invalidate = vi.fn()
  const session = new RayTracingSession(tracer, options, invalidate)
  const frame: SceneRenderFrame = {
    camera: new PerspectiveCamera(),
    renderer: {} as SceneRenderFrame['renderer'],
    edges: null,
    isDragging: false,
    renderRaster: vi.fn(),
  }
  return { session, tracer, frame, options, invalidate }
}

afterEach(() => vi.restoreAllMocks())

describe('ray tracing sessions', () => {
  it.each([
    'ray-tracing',
    'ray-tracing-without-drag',
    'ray-tracing-stealth',
    'ray-tracing-threshold-transition',
  ] as const)('%s keeps its drag and reveal policy', (mode) => {
    const { session, tracer, frame, options } = fixture()
    options.value = { ...options.value, mode }
    frame.isDragging = true
    session.renderFrame(frame)
    expect(tracer.render).toHaveBeenCalledTimes(mode === 'ray-tracing' ? 1 : 0)
    frame.isDragging = false
    session.renderFrame(frame)
    expect(tracer.render).toHaveBeenLastCalledWith(
      frame.camera,
      frame.renderer,
      mode === 'ray-tracing-stealth',
      false,
      mode === 'ray-tracing-threshold-transition' ? 50 : undefined
    )
    session.dispose()
  })

  it.each([0, 0.45, 1])(
    'restores edge opacity %s after a continuous-tracing drag',
    (edgeOpacity) => {
      const { session, tracer, frame, options } = fixture()
      options.value = { ...options.value, mode: 'ray-tracing', edgeOpacity }
      const edges = new EdgeRenderer()
      frame.edges = edges.lines
      tracer.render.mockReturnValue(true)
      session.renderFrame(frame)
      expect(tracer.renderEdges).toHaveBeenLastCalledWith(
        frame.renderer,
        frame.camera,
        frame.edges,
        edgeOpacity
      )
      frame.isDragging = true
      session.renderFrame(frame)
      expect(tracer.renderEdges).toHaveBeenLastCalledWith(
        frame.renderer,
        frame.camera,
        frame.edges,
        1
      )
      frame.isDragging = false
      session.renderFrame(frame)
      expect(tracer.renderEdges).toHaveBeenLastCalledWith(
        frame.renderer,
        frame.camera,
        frame.edges,
        edgeOpacity
      )
      options.value = { ...options.value, edges: false }
      tracer.renderEdges.mockClear()
      frame.isDragging = true
      session.renderFrame(frame)
      expect(tracer.renderEdges).not.toHaveBeenCalled()
      session.dispose()
      edges.dispose()
    }
  )

  it('applies live controls without restarting denoising on every edit', () => {
    const { session, tracer, options, invalidate } = fixture()
    tracer.setDenoise.mockClear()
    options.value = {
      ...options.value,
      thresholdPercent: 75,
      fadeDuration: 1500,
      denoiseFadeDuration: 400,
    }
    expect(tracer.setDenoise).not.toHaveBeenCalled()
    expect(tracer.setDenoiseFadeDuration).toHaveBeenLastCalledWith(400)
    expect(invalidate).toHaveBeenCalled()
    options.value = { ...options.value, denoise: false }
    expect(tracer.setDenoise).toHaveBeenCalledWith(false)
    session.dispose()
    invalidate.mockClear()
    options.value = { ...options.value, denoise: true }
    expect(invalidate).not.toHaveBeenCalled()
    session.dispose()
    expect(tracer.dispose).toHaveBeenCalledOnce()
  })

  it('waits for the sampling threshold, fades in, and immediately returns to raster during dragging', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { session, tracer, frame, options } = fixture()
    options.value = {
      ...options.value,
      fadeDuration: 1000,
      thresholdPercent: 75,
    }
    session.renderFrame(frame)
    expect(tracer.present).not.toHaveBeenCalled()
    now += 2000
    tracer.render.mockReturnValue(true)
    session.renderFrame(frame)
    now += 500
    session.renderFrame(frame)
    expect(tracer.present).toHaveBeenLastCalledWith(
      frame.renderer,
      0.5,
      frame.renderRaster
    )
    tracer.render.mockClear()
    tracer.present.mockClear()
    frame.isDragging = true
    session.renderFrame(frame)
    expect(tracer.render).not.toHaveBeenCalled()
    expect(tracer.present).not.toHaveBeenCalled()
    expect(frame.renderRaster).toHaveBeenCalled()
    session.dispose()
  })

  it('renders standard mode, or a disposed session, without touching the tracer', () => {
    const { session, tracer, frame, options } = fixture()
    options.value = { ...options.value, mode: 'standard' }
    expect(tracer.setDenoise).toHaveBeenLastCalledWith(false)
    session.renderFrame(frame)
    expect(tracer.render).not.toHaveBeenCalled()
    expect(session.needsFrame(false)).toBe(false)
    session.dispose()
    session.renderFrame(frame)
    expect(tracer.render).not.toHaveBeenCalled()
    expect(frame.renderRaster).toHaveBeenCalledTimes(2)
  })
})
