import { useMemo } from 'react'

import type { ContextMenuProps } from '@src/components/ContextMenu'
import {
  ContextMenu,
  ContextMenuDivider,
  ContextMenuItem,
  ContextMenuItemRefresh,
} from '@src/components/ContextMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import type { AxisNames } from '@src/lib/constants'
import { VIEW_NAMES_SEMANTIC } from '@src/lib/constants'
import { kclManager, sceneInfra, settingsActor } from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'
import { useSettings } from '@src/lib/singletons'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import {
  selectDefaultSketchPlane,
  selectOffsetSketchPlane,
} from '@src/lib/selections'
import { getSelectedPlaneId } from '@src/lang/queryAst'

export function useViewControlMenuItems() {
  const { state: modelingState, send: modelingSend } = useModelingContext()
  const selectedPlaneId = getSelectedPlaneId(
    modelingState.context.selectionRanges
  )

  const settings = useSettings()
  const shouldLockView =
    modelingState.matches('Sketch') &&
    !settings.app.allowOrbitInSketchMode.current
    const snapToGrid = settings.modeling.snapToGrid.current


  const menuItems = useMemo(
    () => [
      ...Object.entries(VIEW_NAMES_SEMANTIC).map(([axisName, axisSemantic]) => (
        <ContextMenuItem
          key={axisName}
          onClick={() => {
            sceneInfra.camControls
              .updateCameraToAxis(axisName as AxisNames)
              .catch(reportRejection)
          }}
          disabled={shouldLockView}
        >
          {axisSemantic} view
        </ContextMenuItem>
      )),
      <ContextMenuDivider />,
      <ContextMenuItem
        onClick={() => {
          resetCameraPosition().catch(reportRejection)
        }}
        disabled={shouldLockView}
        hotkey="mod+alt+x"
      >
        Reset view
      </ContextMenuItem>,
      <ContextMenuItem
        onClick={() => {
          modelingSend({ type: 'Center camera on selection' })
        }}
        disabled={shouldLockView}
        hotkey={`mod+alt+c`}
      >
        Center view on selection
      </ContextMenuItem>,
      <ContextMenuDivider />,
      <ContextMenuItem
        onClick={() => {
          if (selectedPlaneId) {
            sceneInfra.modelingSend({
              type: 'Enter sketch',
              data: { forceNewSketch: true },
            })

            const defaultSketchPlaneSelected =
              selectDefaultSketchPlane(selectedPlaneId)
            if (
              !err(defaultSketchPlaneSelected) &&
              defaultSketchPlaneSelected
            ) {
              return
            }

            const artifact = kclManager.artifactGraph.get(selectedPlaneId)
            void selectOffsetSketchPlane(artifact)
          }
        }}
        disabled={!selectedPlaneId}
      >
        Start sketch on selection
      </ContextMenuItem>,
      <ContextMenuDivider />,
        <ContextMenuItem
            icon={snapToGrid ? "checkmark" : undefined}
            hotkey="mod+g"
            onClick={() => {
              settingsActor.send({
                type: 'set.modeling.snapToGrid',
                data: {
                  level: 'project',
                  value: !snapToGrid,
                },
              })
            }}
        >
           Snap to grid
        </ContextMenuItem>,
        <ContextMenuDivider />,
      <ContextMenuItemRefresh />,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [VIEW_NAMES_SEMANTIC, shouldLockView, selectedPlaneId, snapToGrid]
  )
  return menuItems
}

export function ViewControlContextMenu({
  menuTargetElement: wrapperRef,
  ...props
}: ContextMenuProps) {
  const menuItems = useViewControlMenuItems()
  return (
    <ContextMenu
      data-testid="view-controls-menu"
      menuTargetElement={wrapperRef}
      items={menuItems}
      {...props}
    />
  )
}
