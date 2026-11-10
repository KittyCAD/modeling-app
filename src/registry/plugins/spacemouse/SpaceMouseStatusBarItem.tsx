import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon, type CustomIconName } from '@src/components/CustomIcon'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import { trap } from '@src/lib/trap'
import {
  activeSpaceMouseController,
  spaceMouseState,
  type SpaceMouseState,
} from './spaceMouseController'

const statusDetails: Record<
  SpaceMouseState['status'],
  { label: string; icon: CustomIconName }
> = {
  disconnected: { label: 'Disconnected', icon: 'horizontalDash' },
  connecting: { label: 'Connecting', icon: 'loading' },
  connected: { label: 'Connected', icon: 'checkmark' },
  error: { label: 'Error', icon: 'exclamationMark' },
}

export function SpaceMouseStatusBarItem() {
  useSignals()
  const controller = activeSpaceMouseController.value
  const { status, error } = spaceMouseState.value
  const localRenderer = controller?.cameraControls.localCameraMode
  const connected = status === 'connected'
  const action = connected ? 'Disconnect SpaceMouse' : 'Connect SpaceMouse'
  const details = statusDetails[status]
  let label = details.label
  let description =
    error ?? (status === 'connecting' ? 'Connecting SpaceMouse' : action)
  if (!controller) {
    label = 'Idle'
    description = 'Open a model to use SpaceMouse.'
  } else if (!localRenderer) {
    label = 'Unavailable'
    description = 'SpaceMouse requires Use Local Renderer.'
  }

  return (
    <div className="relative flex">
      <button
        type="button"
        className={`${defaultStatusBarItemClassNames} disabled:opacity-50`}
        aria-label={`SpaceMouse: ${label}. ${action}`}
        aria-busy={status === 'connecting'}
        disabled={!localRenderer || status === 'connecting'}
        onClick={() => {
          if (connected) controller?.disconnect()
          else controller?.connect().then(trap).catch(trap)
        }}
      >
        <CustomIcon
          name={details.icon}
          className={`h-4 w-4 shrink-0 ${status === 'connecting' ? 'animate-spin' : ''}`}
        />
      </button>
      <Tooltip
        position="top-left"
        contentClassName="max-w-xs whitespace-normal text-left"
      >
        <div className="font-semibold">SpaceMouse: {label}</div>
        <div>{description}</div>
      </Tooltip>
    </div>
  )
}
