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
import { kclManager, sceneInfra } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { useSettings } from '@src/lib/singletons'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import type { Selections } from '@src/lib/selections'

export function useViewControlMenuItems() {
  const { state: modelingState, send: modelingSend } = useModelingContext()
  const selectedPlaneId = getCurrentPlaneId(
    modelingState.context.selectionRanges
  )

  const settings = useSettings()
  const shouldLockView =
    modelingState.matches('Sketch') &&
    !settings.app.allowOrbitInSketchMode.current
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

            if (sceneInfra.selectDefaultSketchPlane(selectedPlaneId)) {
              return
            }

            const artifact = kclManager.artifactGraph.get(selectedPlaneId)
            void sceneInfra.selectOffsetSketchPlane(artifact)
          }
        }}
        disabled={!selectedPlaneId}
      >
        Start sketch on selection
      </ContextMenuItem>,
      <ContextMenuDivider />,
      <ContextMenuItemRefresh />,
    ],
    [VIEW_NAMES_SEMANTIC, shouldLockView, selectedPlaneId]
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

function getCurrentPlaneId(selectionRanges: Selections): string | null {
  const defaultPlane = selectionRanges.otherSelections.find(
    (selection) => typeof selection === 'object' && 'name' in selection
  )
  if (defaultPlane) {
    return defaultPlane.id
  }

  const planeSelection = selectionRanges.graphSelections.find(
    (selection) => selection.artifact?.type === 'plane'
  )
  if (planeSelection) {
    return planeSelection.artifact?.id || null
  }

  return null
}
