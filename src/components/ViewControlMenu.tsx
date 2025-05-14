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
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  VIEW_NAMES_SEMANTIC,
} from '@src/lib/constants'
import {
  engineCommandManager,
  kclManager,
  sceneInfra,
} from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { useSettings } from '@src/lib/singletons'
import { isPlaywright } from '@src/lib/isPlaywright'
import {
  engineStreamZoomToFit,
  engineViewIsometricWithoutGeometryPresent,
  engineViewIsometricWithGeometryPresent,
} from '@src/lib/utils'

export function useViewControlMenuItems() {
  const { state: modelingState, send: modelingSend } = useModelingContext()
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
          // Gotcha: Playwright E2E tests will be zoom_to_fit, when you try to recreate the e2e test manually
          // your localhost will do view_isometric. Turn this boolean on to have the same experience when manually
          // debugging e2e tests

          // We need a padding of 0.1 for zoom_to_fit for all E2E tests since they were originally
          // written with zoom_to_fit with padding 0.1
          const padding = 0.1
          if (isPlaywright()) {
            engineStreamZoomToFit({ engineCommandManager, padding }).catch(
              reportRejection
            )
          } else {
            // If the scene is empty you cannot use view_isometric, it will not move the camera
            if (kclManager.isAstBodyEmpty(kclManager.ast)) {
              engineViewIsometricWithoutGeometryPresent({
                engineCommandManager,
                unit:
                  kclManager.fileSettings.defaultLengthUnit ||
                  DEFAULT_DEFAULT_LENGTH_UNIT,
              }).catch(reportRejection)
            } else {
              engineViewIsometricWithGeometryPresent({
                engineCommandManager,
                padding,
              }).catch(reportRejection)
            }
          }
        }}
        disabled={shouldLockView}
      >
        Reset view
      </ContextMenuItem>,
      <ContextMenuItem
        onClick={() => {
          modelingSend({ type: 'Center camera on selection' })
        }}
        disabled={shouldLockView}
      >
        Center view on selection
      </ContextMenuItem>,
      <ContextMenuDivider />,
      <ContextMenuItemRefresh />,
    ],
    [VIEW_NAMES_SEMANTIC, shouldLockView]
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
