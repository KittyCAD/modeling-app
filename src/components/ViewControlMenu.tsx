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
import { err, reportRejection } from '@src/lib/trap'
import { useSettings } from '@src/lib/singletons'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import type { Selections } from '@src/lib/selections'
import {
  selectDefaultSketchPlane,
  selectOffsetSketchPlane,
} from '@src/lib/selections'

export function useViewControlMenuItems() {
  const { state: modelingState, send: modelingSend } = useModelingContext()
  const selectedPlaneId = getCurrentPlaneId(
    modelingState.context.selectionRanges
  )

  const settings = useSettings()
  const shouldLockView =
    modelingState.matches('Sketch') &&
    !settings.app.allowOrbitInSketchMode.current

  // Check if there's a valid selection with source range for "View KCL source code"
  const hasValidSelection = useMemo(() => {
    const selections = modelingState.context.selectionRanges.graphSelections
    return (
      selections.length > 0 &&
      selections.some((selection) => {
        return (
          selection.codeRef?.range &&
          selection.codeRef.range[0] !== undefined &&
          selection.codeRef.range[1] !== undefined
        )
      })
    )
  }, [modelingState.context.selectionRanges.graphSelections])

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
      <ContextMenuItem
        onClick={() => {
          // Get the first valid selection with a source range
          const selection =
            modelingState.context.selectionRanges.graphSelections.find(
              (sel) =>
                sel.codeRef?.range &&
                sel.codeRef.range[0] !== undefined &&
                sel.codeRef.range[1] !== undefined
            )

          if (selection?.codeRef?.range) {
            // First, open the code pane if it's not already open
            if (!modelingState.context.store.openPanes.includes('code')) {
              modelingSend({
                type: 'Set context',
                data: {
                  openPanes: [...modelingState.context.store.openPanes, 'code'],
                },
              })
            }

            // Navigate to the source code location
            modelingSend({
              type: 'Set selection',
              data: {
                selectionType: 'singleCodeCursor',
                selection: {
                  artifact: selection.artifact,
                  codeRef: selection.codeRef,
                },
                scrollIntoView: true,
              },
            })
          }
        }}
        disabled={!hasValidSelection}
      >
        View KCL source code
      </ContextMenuItem>,
      <ContextMenuDivider />,
      <ContextMenuItemRefresh />,
    ],
    [
      VIEW_NAMES_SEMANTIC,
      shouldLockView, selectedPlaneId,
      hasValidSelection,
      modelingState.context.selectionRanges.graphSelections,
      modelingState.context.store.openPanes,
    ]
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
