import { defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { SceneRenderingService } from '@src/registry/contracts/sceneRendering'

export type RenderingMode =
  | 'standard'
  | 'ray-tracing'
  | 'ray-tracing-without-drag'
  | 'ray-tracing-stealth'
  | 'ray-tracing-threshold-transition'

export interface RayTracingOptions {
  mode: RenderingMode
  denoise: boolean
  edges: boolean
  edgeOpacity: number
  fadeDuration: number
  denoiseFadeDuration: number
  thresholdPercent: number
}

export interface RayTracingService extends SceneRenderingService {
  readonly options: ReadonlySignal<RayTracingOptions>
  update(options: Partial<RayTracingOptions>): void
}

export const rayTracingService = defineService<RayTracingService>('ray-tracing')
