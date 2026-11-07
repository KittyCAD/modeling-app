import { useMemo } from 'react'
import Gizmo from '@src/components/gizmo/Gizmo'
import { createLegacyGizmoCamera } from '@src/components/gizmo/legacyCamera'
import { useViewControlMenuItems } from '@src/components/ViewControlMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useResolvedTheme } from '@src/hooks/useResolvedTheme'
import { useApp, useSingletons } from '@src/lib/boot'

/** Adapts legacy project state and actions to the scene-independent gizmo. */
export default function LegacyGizmo() {
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const { state } = useModelingContext()
  const values = settings.useSettings()
  const menuItems = useViewControlMenuItems()
  const theme = useResolvedTheme()
  const scene = kclManager.sceneInfra
  const camera = useMemo(() => createLegacyGizmoCamera(scene), [scene])

  return (
    <Gizmo
      key={scene.scene.uuid}
      camera={camera}
      gizmoType={values.modeling.gizmoType.current}
      theme={theme}
      orbitEnabled={
        !state.matches('Sketch') || values.app.allowOrbitInSketchMode.current
      }
      menuItems={menuItems}
    />
  )
}
