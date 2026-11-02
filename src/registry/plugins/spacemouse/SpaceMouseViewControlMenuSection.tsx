import { useSignals } from '@preact/signals-react/runtime'
import { ContextMenuItem } from '@src/components/ContextMenu'
import { trap } from '@src/lib/trap'
import {
  activeSpaceMouseController,
  spaceMouseState,
} from './spaceMouseController'

export function SpaceMouseViewControlMenuSection() {
  useSignals()
  const controller = activeSpaceMouseController.value
  const { status } = spaceMouseState.value
  const localRenderer = controller?.cameraControls.localCameraMode

  return (
    <ContextMenuItem
      onClick={() => {
        if (status === 'connected') {
          controller?.disconnect()
        } else {
          controller?.connect().then(trap).catch(trap)
        }
      }}
      disabled={!localRenderer || status === 'connecting'}
    >
      {!localRenderer
        ? 'SpaceMouse Requires Local Renderer'
        : status === 'connected'
          ? 'Disconnect SpaceMouse'
          : status === 'connecting'
            ? 'Connecting SpaceMouse'
            : 'Connect SpaceMouse'}
    </ContextMenuItem>
  )
}
