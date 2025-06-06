import { OrthographicCamera, PerspectiveCamera } from 'three'
import { _3DMouseThreeJSWindows } from '@src/lib/externalMouse/external-mouse-threejs'

const donePrefix = 'xstate.done.actor.'
const errorPrefix = 'xstate.error.actor.'

export type _3DMouseContext = {
  _3dMouse: _3DMouseThreeJSWindows | null
  /** Use this object for internal retries on behalf of the user */
  lastConfigurationForConnection: {
    name: string
    debug: boolean
    canvasId: string
    camera: PerspectiveCamera | OrthographicCamera | null
  } | null
  retries: number
  maxRetries: number
}

export enum _3DMouseMachineStates {
  waitingToConnect = 'waiting to connect',
  connecting = 'connecting',
  connected = 'connected',
  failedToConnect = 'failed to connect',
  /** Automatic reconnection, this will internally transistion.
   * I do not recommend making an event to transition here from a .send() call
   */
  retryConnection = 'retry connection',
}

export enum _3DMouseMachineEvents {
  connect = 'connect',
  done_connect = donePrefix + 'connect',
  error_connect = errorPrefix + 'connect',
}

export enum _3DMouseMachineActors {
  connect = 'connect',
}
