import { ClientSideScene } from '@src/clientSideScene/ClientSideSceneComp'
import { useApp } from '@src/lib/boot'
import type { EngineSceneExtensionContext } from '@src/registry/contracts/engineScene'

export function BuiltInModeScene({
  sketchSolveStreamDimming,
}: EngineSceneExtensionContext) {
  const { settings } = useApp()
  const settingsValues = settings.useSettings()

  return (
    <ClientSideScene
      cameraControls={settingsValues.modeling.mouseControls.current}
      enableTouchControls={settingsValues.modeling.enableTouchControls.current}
      sketchSolveStreamDimming={sketchSolveStreamDimming}
    />
  )
}
