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
}: {
  camera: Pick<CameraControls, 'updateCameraToAxis' | 'zoomToFit'>
  reset: () => Promise<void>
  center: () => Promise<void>
  disabled?: boolean
  centerDisabled?: boolean
}) {
  return [
    ...Object.values(AxisNames).map((axisName) => (
      <ContextMenuItem
        key={axisName}
        onClick={() => {
          camera.updateCameraToAxis(axisName).catch(reportRejection)
        }}
        disabled={disabled}
      >
        {VIEW_NAMES_SEMANTIC[axisName]} view
      </ContextMenuItem>
    )),
    <ContextMenuDivider />,
    <ContextMenuItem
      onClick={() => {
        camera
          .zoomToFit({ padding: ZOOM_TO_FIT_PADDING })
          .catch(reportRejection)
      }}
      hotkey="mod+alt+f"
    >
      Zoom to fit
    </ContextMenuItem>,
    <ContextMenuItem
      onClick={() => {
        reset().catch(reportRejection)
      }}
      disabled={disabled}
      hotkey="mod+alt+x"
    >
      Reset view
    </ContextMenuItem>,
    <ContextMenuItem
      onClick={() => {
        center().catch(reportRejection)
      }}
      disabled={centerDisabled ?? disabled}
      hotkey={`mod+alt+c`}
    >
      Center view on selection
    </ContextMenuItem>,
  ]
}
