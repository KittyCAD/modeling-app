import { useModelingContext } from 'hooks/useModelingContext'
import { AxisNames, VIEW_NAMES_SEMANTIC } from 'lib/constants'
import { sceneInfra } from 'lib/singletons'
import { reportRejection } from 'lib/trap'
import { useSettings } from 'machines/appMachine'
import { useMemo } from 'react'

import {
  ContextMenu,
  ContextMenuDivider,
  ContextMenuItem,
  ContextMenuItemRefresh,
  ContextMenuProps,
} from './ContextMenu'

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
          sceneInfra.camControls.resetCameraPosition().catch(reportRejection)
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
