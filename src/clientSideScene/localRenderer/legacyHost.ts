import type { KclManager } from '@src/lang/KclManager'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type { LocalRendererHost } from '@src/clientSideScene/localRenderer/host'

/** The legacy route supplies scene inputs from its manager; the presentation never owns that manager. */
export function legacyLocalRendererHost(
  manager: KclManager
): LocalRendererHost {
  return {
    executionEvents: manager,
    executing: manager.isExecutingSignal,
    sceneGeneration: manager.engineSceneGenerationSignal,
    currentSceneGeneration: () => manager.execState.engineSceneGeneration,
    selectionFilter: manager.selectionFilter,
    commands: manager.engineCommandManager,
    sceneInfra: manager.sceneInfra,
    settingsActor: manager.systemDeps.settings,
    artifacts: () => manager.artifactGraph,
    defaultPlanes: () => manager.rustContext.defaultPlanes,
    hasErrors: () => manager.hasErrors(),
    exportModel: (format) =>
      manager.rustContext.export(
        format,
        jsAppSettings(manager.systemDeps.settings)
      ),
    get captureThumbnail() {
      return manager.captureProjectThumbnail
    },
  }
}
