import { useApp, useSingletons } from '@src/lib/boot'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { GizmoView } from '@src/components/gizmo/GizmoView'
import { useViewControlMenuItems } from '@src/components/ViewControlMenu'
import { useResolvedTheme } from '@src/hooks/useResolvedTheme'

export default function Gizmo() {
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const menuItems = useViewControlMenuItems()
  const settingsValues = settings.useSettings()
  const gizmoType = settingsValues.modeling.gizmoType.current
  // Disposing a gizmo loses its WebGL context; a new scene needs a new canvas.
  const sceneKey = kclManager.sceneInfra.scene.uuid

  const theme = useResolvedTheme()
  const { state } = useModelingContext()
  return (
    <GizmoView
      key={sceneKey}
      sceneInfra={kclManager.sceneInfra}
      gizmoType={gizmoType}
      theme={theme}
      menuItems={menuItems}
      disabled={
        state.matches('Sketch') &&
        !settingsValues.app.allowOrbitInSketchMode.current
      }
    />
  )
}
