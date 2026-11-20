import { useApp, useSingletons } from '@src/lib/boot'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { CubeGizmoView } from '@src/components/gizmo/CubeGizmoView'
import { useResolvedTheme } from '@src/hooks/useResolvedTheme'

export default function CubeGizmo() {
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const { state: modelingState } = useModelingContext()
  const settingsValues = settings.useSettings()

  const resolvedTheme = useResolvedTheme()

  return (
    <CubeGizmoView
      sceneInfra={kclManager.sceneInfra}
      resolvedTheme={resolvedTheme}
      disableOrbit={
        modelingState.matches('Sketch') &&
        !settingsValues.app.allowOrbitInSketchMode.current
      }
    />
  )
}
