import { useApp, useSingletons } from '@src/lib/boot'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { AxisGizmoView } from '@src/components/gizmo/AxisGizmoView'
import { useViewControlMenuItems } from '@src/components/ViewControlMenu'

export default function AxisGizmo() {
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const { sceneInfra } = kclManager
  const { state: modelingState } = useModelingContext()
  const settingsValues = settings.useSettings()
  const items = useViewControlMenuItems()
  return (
    <AxisGizmoView
      sceneInfra={sceneInfra}
      disabled={
        modelingState.matches('Sketch') &&
        !settingsValues.app.allowOrbitInSketchMode.current
      }
      menuItems={items}
    />
  )
}
