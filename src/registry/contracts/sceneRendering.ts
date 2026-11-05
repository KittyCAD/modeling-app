import { defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { SceneRenderExtensionFactory } from '@src/clientSideScene/localRenderer/renderExtension'

/** Optional renderer supplied by a plugin; the viewport retains its raster fallback. */
export interface SceneRenderingService {
  readonly supported: ReadonlySignal<boolean>
  registerViewport(supported: boolean): () => void
  create: SceneRenderExtensionFactory
}

export const sceneRenderingService =
  defineService<SceneRenderingService>('scene-rendering')
