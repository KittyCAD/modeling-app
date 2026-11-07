import { useSignals } from '@preact/signals-react/runtime'
import {
  ContextMenuDivider,
  ContextMenuItem,
} from '@src/components/ContextMenu'
import Gizmo from '@src/components/gizmo/Gizmo'
import { orientToAxis } from '@src/components/gizmo/camera'
import { AxisNames, VIEW_NAMES_SEMANTIC } from '@src/lib/constants'
import type { KclSession } from '@src/lib/kcl/session'
import type { ResolvedTheme } from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'

/** View controls use this executor's camera; settings remain owned by the settings service. */
export default function KclGizmo({
  session,
  settings,
  theme,
}: {
  session: Pick<KclSession, 'camera'>
  settings: Pick<SettingsRegistryService, 'current' | 'send'>
  theme: ResolvedTheme
}) {
  useSignals()
  const camera = session.camera.value
  if (!camera) return null
  const state = camera.state.value
  if (state.type === 'error')
    return (
      <p role="alert" className="body-bg rounded p-2 text-sm">
        {state.error.message}
      </p>
    )
  if (state.type !== 'ready') return null
  const gizmoType =
    settings.current.value.modeling.gizmoType.currentSignal.value
  const menuItems = [
    ...Object.values(AxisNames).map((axis) => (
      <ContextMenuItem
        key={axis}
        onClick={() => {
          orientToAxis(camera, axis).catch(reportRejection)
        }}
      >
        {VIEW_NAMES_SEMANTIC[axis]} view
      </ContextMenuItem>
    )),
    <ContextMenuDivider key="gizmo-divider" />,
    <ContextMenuItem
      key="gizmo-type"
      onClick={() =>
        settings.send({
          type: 'set.modeling.gizmoType',
          data: {
            level: 'user',
            value: gizmoType === 'axis' ? 'cube' : 'axis',
          },
        })
      }
    >
      {gizmoType === 'axis' ? 'Use cube gizmo' : 'Use axis gizmo'}
    </ContextMenuItem>,
  ]
  return (
    <Gizmo
      key={camera.id}
      camera={camera}
      gizmoType={gizmoType}
      theme={theme}
      orbitEnabled
      menuItems={menuItems}
    />
  )
}
