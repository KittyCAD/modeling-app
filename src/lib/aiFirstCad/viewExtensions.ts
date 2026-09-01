import type { AiFirstCadMode } from '@src/lib/aiFirstCad/context'
import type { EngineSceneViewExtension } from '@src/registry/contracts/engineScene'

const MODELING_TOOLBAR_EXTENSION_ID = 'engine-scene.toolbar'
const GIZMO_EXTENSION_ID = 'engine-scene.gizmo'

export function getViewExtensionsForMode(
  _mode: AiFirstCadMode,
  extensions: readonly EngineSceneViewExtension[],
  isCanvasGridVisible = false
) {
  return extensions.filter(
    (extension) =>
      extension.id !== MODELING_TOOLBAR_EXTENSION_ID &&
      (!isCanvasGridVisible || extension.id !== GIZMO_EXTENSION_ID)
  )
}
