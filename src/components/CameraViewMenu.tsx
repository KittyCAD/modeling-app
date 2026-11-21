import {
  cameraViewDefinitions,
  type CameraShortcutHints,
} from '@src/lib/cameraViewCommands'
import type { CameraControls } from '@src/clientSideScene/CameraControls'
import {
  ContextMenuDivider,
  ContextMenuItem,
} from '@src/components/ContextMenu'
import {
  VIEW_NAMES_SEMANTIC,
  ZOOM_TO_FIT_PADDING,
  AxisNames,
} from '@src/lib/constants'
import { reportRejection } from '@src/lib/trap'

/** Camera actions shared by the legacy route and executor-owned view menus. */
export function createCameraViewMenuItems({
  camera,
  reset,
  center,
  disabled = false,
  centerDisabled,
  shortcuts,
}: {
  camera: Pick<CameraControls, 'updateCameraToAxis' | 'zoomToFit'>
  reset: () => Promise<void>
  center: () => Promise<void>
  disabled?: boolean
  centerDisabled?: boolean
  shortcuts?: CameraShortcutHints
}) {
  return [
    ...Object.values(AxisNames).map((axisName) => {
      const view = cameraViewDefinitions.find(
        (view) => 'axis' in view && view.axis === axisName
      )
      return (
        <ContextMenuItem
          key={axisName}
          onClick={() => {
            camera.updateCameraToAxis(axisName).catch(reportRejection)
          }}
          disabled={disabled}
          hotkey={view ? shortcuts?.[view.id] : undefined}
        >
          {VIEW_NAMES_SEMANTIC[axisName]} view
        </ContextMenuItem>
      )
    }),
    <ContextMenuDivider key="camera-divider" />,
    <ContextMenuItem
      key="fit"
      onClick={() => {
        camera
          .zoomToFit({ padding: ZOOM_TO_FIT_PADDING })
          .catch(reportRejection)
      }}
      hotkey={shortcuts?.fit}
    >
      Zoom to fit
    </ContextMenuItem>,
    <ContextMenuItem
      key="reset"
      onClick={() => {
        reset().catch(reportRejection)
      }}
      disabled={disabled}
      hotkey={shortcuts?.reset}
    >
      Reset view
    </ContextMenuItem>,
    <ContextMenuItem
      key="center"
      onClick={() => {
        center().catch(reportRejection)
      }}
      disabled={centerDisabled ?? disabled}
      hotkey={shortcuts?.center}
    >
      Center view on selection
    </ContextMenuItem>,
  ]
}
