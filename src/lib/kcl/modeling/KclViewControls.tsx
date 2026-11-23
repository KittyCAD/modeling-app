import type { ReadonlySignal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { lazy, Suspense } from 'react'
import type { RefObject } from 'react'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { createCameraViewMenuItems } from '@src/components/CameraViewMenu'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuDivider,
} from '@src/components/ContextMenu'
import type { KclSceneResource } from '@src/lib/kcl/scene/open'
import type { ResolvedTheme } from '@src/lib/theme'

const GizmoView = lazy(async () => ({
  default: (await import('@src/components/gizmo/GizmoView')).GizmoView,
}))

/** Camera presentation borrowed by this view; the scene resource owns its lifetime. */
export interface KclViewControlHost {
  id: string
  sceneInfra: Pick<SceneInfra, 'camControls'>
  theme: ReadonlySignal<ResolvedTheme>
  gizmoType: ReadonlySignal<'axis' | 'cube'>
  toggleGizmo: () => void
  reset: () => Promise<void>
}

export function KclViewControls({
  resource,
  target,
}: {
  resource: KclSceneResource
  target: RefObject<HTMLDivElement | null>
}) {
  useSignals()
  const host = resource.viewControls
  const disabled = resource.runtime.executing.value
  const selected = resource.selection.displayed.value.length > 0
  const camera = host?.sceneInfra.camControls
  if (!host || !camera) return null
  const items = [
    ...createCameraViewMenuItems({
      camera,
      showShortcutLabels: false,
      reset: host.reset,
      center: () => camera.centerOnSelection(),
      disabled,
      centerDisabled: disabled || !selected,
    }),
    <ContextMenuDivider key="gizmo-divider" />,
    <ContextMenuItem key="gizmo-toggle" onClick={host.toggleGizmo}>
      {host.gizmoType.value === 'axis' ? 'Use cube gizmo' : 'Use axis gizmo'}
    </ContextMenuItem>,
    // TODO: Add source navigation through an explicit linked Code view, and Start Sketch through its contributed command.
  ]
  return (
    <>
      <ContextMenu
        key={host.id}
        menuTargetElement={target}
        event="mouseup"
        guard={(event) => event.button === 2 && !camera.wasDragging}
        items={items}
      />
      <div className="absolute bottom-4 right-4 z-40">
        <Suspense fallback={null}>
          <GizmoView
            key={host.id}
            sceneInfra={host.sceneInfra}
            gizmoType={host.gizmoType.value}
            theme={host.theme.value}
            menuItems={items}
            disabled={disabled}
          />
        </Suspense>
      </div>
    </>
  )
}
