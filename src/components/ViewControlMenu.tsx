import { useMemo, memo } from 'react'

import type { ContextMenuProps } from '@src/components/ContextMenu'
import {
  ContextMenu,
  ContextMenuDivider,
  ContextMenuItem,
} from '@src/components/ContextMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { getSelectedSketchTarget } from '@src/lang/queryAst'
import type { AxisNames } from '@src/lib/constants'
import { VIEW_NAMES_SEMANTIC } from '@src/lib/constants'
import { SNAP_TO_GRID_HOTKEY } from '@src/lib/hotkeys'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { useApp, useSingletons } from '@src/lib/boot'
import { reportRejection } from '@src/lib/trap'
import toast from 'react-hot-toast'
import { selectSketchPlane } from '@src/hooks/useEngineConnectionSubscriptions'
import {
  DefaultLayoutPaneID,
  getOpenPanes,
  setOpenPanes,
} from '@src/lib/layout'
import { useSignals } from '@preact/signals-react/runtime'

export function useViewControlMenuItems() {
  useSignals()
  const { settings, layout } = useApp()
  const { engineCommandManager, kclManager, rustContext } = useSingletons()
  const { state: modelingState, send: modelingSend } = useModelingContext()
  const planeOrFaceId = getSelectedSketchTarget(
    modelingState.context.selectionRanges
  )

  const settingsValues = settings.useSettings()
  const shouldLockView =
    modelingState.matches('Sketch') &&
    !settingsValues.app.allowOrbitInSketchMode.current

  const sketching = modelingState.matches('Sketch')
  const snapToGrid = settingsValues.modeling.snapToGrid.current
  const gizmoType = settingsValues.modeling.gizmoType.current

  // Check if there's a valid selection with source range for "View KCL source code"
  const firstValidSelection = useMemo(() => {
    return modelingState.context.selectionRanges.graphSelections.find(
      (selection) => {
        return (
          selection.codeRef?.range &&
          selection.codeRef.range[0] !== undefined &&
          selection.codeRef.range[1] !== undefined
        )
      }
    )
  }, [modelingState.context.selectionRanges.graphSelections])

  const menuItems = useMemo(
    () => [
      ...Object.entries(VIEW_NAMES_SEMANTIC).map(([axisName, axisSemantic]) => (
        <ContextMenuItem
          key={axisName}
          onClick={() => {
            kclManager.sceneInfra.camControls
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
          resetCameraPosition({
            sceneInfra: kclManager.sceneInfra,
            engineCommandManager,
            settingsActor: settings.actor,
          }).catch(reportRejection)
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
      <ContextMenuItem
        key="go-to-selection"
        onClick={() => {
          if (firstValidSelection?.codeRef?.range) {
            // First, open the code pane if it's not already open
            const rootLayout = layout.signal.value
            setOpenPanes(rootLayout, [
              ...getOpenPanes({ rootLayout }),
              DefaultLayoutPaneID.Code,
            ])

            // Navigate to the source code location
            modelingSend({
              type: 'Set selection',
              data: {
                selectionType: 'singleCodeCursor',
                selection: {
                  artifact: firstValidSelection.artifact,
                  codeRef: firstValidSelection.codeRef,
                },
                scrollIntoView: true,
              },
            })
          } else {
            toast.error(
              'No valid selection with source range found. Please select a valid element.'
            )
          }
        }}
        disabled={!firstValidSelection}
      >
        View KCL source code
      </ContextMenuItem>,
      <ContextMenuDivider />,
      <ContextMenuItem
        onClick={() => {
          settings.send({
            type: 'set.modeling.gizmoType',
            data: {
              level: 'user',
              value: gizmoType === 'axis' ? 'cube' : 'axis',
            },
          })
        }}
      >
        {gizmoType === 'axis' ? 'Use cube gizmo' : 'Use axis gizmo'}
      </ContextMenuItem>,
      <ContextMenuDivider />,
      <ContextMenuItem
        onClick={() => {
          if (planeOrFaceId) {
            kclManager.sceneInfra.modelingSend({
              type: 'Enter sketch',
              data: { forceNewSketch: true, keepDefaultPlaneVisibility: true },
            })

            void selectSketchPlane(
              planeOrFaceId,
              modelingState.context.store.useNewSketchMode?.current,
              {
                kclManager,
                rustContext,
              }
            )
          }
        }}
        disabled={!planeOrFaceId}
      >
        Start sketch on selection
      </ContextMenuItem>,
      ...(sketching
        ? [
            <ContextMenuDivider />,
            <ContextMenuItem
              icon={snapToGrid ? 'checkmark' : undefined}
              hotkey={SNAP_TO_GRID_HOTKEY}
              onClick={() => {
                settings.send({
                  type: 'set.modeling.snapToGrid',
                  data: {
                    level: 'project',
                    value: !snapToGrid,
                  },
                })
              }}
            >
              Snap to Grid
            </ContextMenuItem>,
          ]
        : []),
    ],
    [
      shouldLockView,
      planeOrFaceId,
      firstValidSelection,
      modelingSend,
      modelingState.context.store.useNewSketchMode,
      sketching,
      snapToGrid,
      gizmoType,
      engineCommandManager,
      layout.signal.value,
      kclManager,
      rustContext,
      settings,
    ]
  )
  return menuItems
}

export const ViewControlContextMenu = memo(function ViewControlContextMenu({
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
})
