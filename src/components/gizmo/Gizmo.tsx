import GizmoDropdown from '@src/components/gizmo/GizmoDropdown'
import { useModelingContext } from '@src/hooks/useModelingContext'
import AxisGizmo from '@src/components/gizmo/AxisGizmo'
import CubeGizmo from '@src/components/gizmo/CubeGizmo'
import { useApp, useSingletons } from '@src/lib/boot'

export default function Gizmo() {
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const { state } = useModelingContext()
  const settingsValues = settings.useSettings()
  const gizmoType = settingsValues.modeling.gizmoType.current
  // Disposing a gizmo loses its WebGL context; a new scene needs a new canvas.
  const sceneKey = kclManager.sceneInfra.scene.uuid

  return (
    <div className="relative">
      {gizmoType === 'axis' ? (
        <AxisGizmo key={sceneKey} />
      ) : (
        <CubeGizmo key={sceneKey} />
      )}
      <GizmoDropdown canOfferHelp={state.matches('idle')} />
    </div>
  )
}
