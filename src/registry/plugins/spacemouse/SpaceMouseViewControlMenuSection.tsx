import { useSignals } from '@preact/signals-react/runtime'
import { ContextMenuItem } from '@src/components/ContextMenu'
import toast from 'react-hot-toast'
import {
  getActiveSpaceMouseController,
  isSpaceMouseSupported,
  logSpaceMouse,
  spaceMouseState,
} from './spaceMouseController'

export function SpaceMouseViewControlMenuSection() {
  useSignals()

  const spaceMouse = spaceMouseState.value
  const canUseSpaceMouse =
    isSpaceMouseSupported() && getActiveSpaceMouseController() !== null
  const isReceivingInput = spaceMouse.lastInputAt !== undefined

  return (
    <ContextMenuItem
      onClick={() => {
        const controller = getActiveSpaceMouseController()
        logSpaceMouse('info', 'connect menu item clicked', {
          canUseSpaceMouse,
          status: spaceMouse.status,
          hasController: controller !== null,
          driverBridgeSupported: isSpaceMouseSupported(),
        })
        controller?.connect().catch((error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : 'Unable to connect SpaceMouse.'
          )
        })
      }}
      disabled={
        !canUseSpaceMouse ||
        spaceMouse.status === 'connecting' ||
        spaceMouse.status === 'unsupported'
      }
    >
      {spaceMouse.status === 'connected'
        ? isReceivingInput
          ? `Reconnect ${spaceMouse.deviceName ?? 'SpaceMouse'}`
          : `Connected ${spaceMouse.deviceName ?? 'SpaceMouse'}`
        : spaceMouse.status === 'connecting'
          ? 'Connecting SpaceMouse'
          : spaceMouse.status === 'error'
            ? 'Reconnect SpaceMouse'
            : 'Connect SpaceMouse'}
    </ContextMenuItem>
  )
}
