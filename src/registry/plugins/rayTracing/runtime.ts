import { signal } from '@preact/signals-core'
import type { SceneRenderExtension } from '@src/clientSideScene/localRenderer/renderExtension'
import type {
  RayTracingOptions,
  RayTracingService,
} from '@src/registry/contracts/rayTracing'

export const defaultRayTracingOptions: RayTracingOptions = {
  mode: 'ray-tracing-threshold-transition',
  denoise: true,
  edges: true,
  edgeOpacity: 0.45,
  fadeDuration: 800,
  denoiseFadeDuration: 200,
  thresholdPercent: 50,
}

export function createRayTracingRuntime() {
  const options = signal({ ...defaultRayTracingOptions })
  const supported = signal(false)
  const sessions = new Set<SceneRenderExtension>()
  let disposed = false
  let supportedViewports = 0
  const service: RayTracingService = {
    options,
    supported,
    registerViewport(value) {
      if (disposed) return () => {}
      let registered = true
      if (value) supportedViewports++
      supported.value = supportedViewports > 0
      return () => {
        if (!registered || disposed) return
        registered = false
        if (value) supportedViewports--
        supported.value = supportedViewports > 0
      }
    },
    update(value) {
      if (disposed) return
      const next = { ...options.value, ...value }
      if (
        !Number.isFinite(next.fadeDuration) ||
        next.fadeDuration < 0 ||
        !Number.isFinite(next.denoiseFadeDuration) ||
        next.denoiseFadeDuration < 0 ||
        !Number.isFinite(next.edgeOpacity) ||
        next.edgeOpacity < 0 ||
        next.edgeOpacity > 1 ||
        !Number.isFinite(next.thresholdPercent) ||
        next.thresholdPercent < 0 ||
        next.thresholdPercent > 100
      )
        return
      options.value = next
    },
    async create(context) {
      const { createRayTracingSession } = await import('./RayTracingSession')
      if (disposed) return null
      const session = await createRayTracingSession(context, options, () =>
        sessions.delete(session)
      )
      if (disposed) {
        session.dispose()
        return null
      }
      sessions.add(session)
      return session
    },
  }
  return {
    service,
    dispose() {
      disposed = true
      supportedViewports = 0
      supported.value = false
      for (const session of sessions) session.dispose()
      sessions.clear()
    },
  }
}
