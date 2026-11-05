import type {
  SceneRenderContext,
  SceneRenderExtension,
} from '@src/clientSideScene/localRenderer/renderExtension'
import { describe, expect, it, vi } from 'vitest'
const createSession = vi.hoisted(() => vi.fn())
vi.mock('./RayTracingSession', () => ({
  createRayTracingSession: createSession,
}))
import { createRayTracingRuntime } from './runtime'

function session() {
  return {
    setModel: vi.fn(),
    cameraChanged: vi.fn(),
    resized: vi.fn(),
    renderFrame: vi.fn(),
    needsFrame: vi.fn(),
    dispose: vi.fn(),
  }
}
const context = {} as SceneRenderContext

describe('ray tracing plugin lifecycle', () => {
  it('disposes every attached viewport when the plugin is disabled', async () => {
    const runtime = createRayTracingRuntime()
    const first = session(),
      second = session()
    createSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    await runtime.service.create(context)
    await runtime.service.create(context)
    runtime.dispose()
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(second.dispose).toHaveBeenCalledOnce()
    expect(await runtime.service.create(context)).toBeNull()
  })

  it('disposes a session whose GPU initialization completes after disabling', async () => {
    let complete: ((value: SceneRenderExtension) => void) | undefined
    createSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    const runtime = createRayTracingRuntime()
    const pending = runtime.service.create(context)
    await vi.waitFor(() => expect(complete).toBeDefined())
    runtime.dispose()
    const late = session()
    complete?.(late)
    expect(await pending).toBeNull()
    expect(late.dispose).toHaveBeenCalledOnce()
  })

  it('tracks support across multiple viewports and removes it on unmount', () => {
    const runtime = createRayTracingRuntime()
    const removeGpu = runtime.service.registerViewport(true)
    const removeWebgl = runtime.service.registerViewport(false)
    expect(runtime.service.supported.value).toBe(true)
    removeWebgl()
    expect(runtime.service.supported.value).toBe(true)
    removeGpu()
    expect(runtime.service.supported.value).toBe(false)
    removeGpu()
    runtime.service.registerViewport(true)
    runtime.dispose()
    expect(runtime.service.supported.value).toBe(false)
  })

  it('ignores invalid controls and changes after disposal', () => {
    const runtime = createRayTracingRuntime()
    runtime.service.update({ thresholdPercent: -1 })
    expect(runtime.service.options.value.thresholdPercent).toBe(50)
    runtime.service.update({ thresholdPercent: 75, fadeDuration: 0 })
    expect(runtime.service.options.value.thresholdPercent).toBe(75)
    runtime.dispose()
    runtime.service.update({ thresholdPercent: 25 })
    expect(runtime.service.options.value.thresholdPercent).toBe(75)
  })
})
