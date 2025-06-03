import { assertEvent, assign, fromPromise, setup } from 'xstate'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { OrthographicCamera, PerspectiveCamera } from 'three'
import { _3DMouseThreeJS } from '@src/lib/externalMouse/external-mouse-threejs'

const donePrefix = 'xstate.done.actor.'
const prefixForErrors = '[3dconnexion]'

type _3DMouseContext = {
  _3dMouse: null
}

enum _3DMouseMachineStates {
  waitingToConnect = 'waiting to connect',
  connecting = 'connecting',
  connected = 'connected',
  failedToConnect = 'failed to connect',
}

enum _3DMouseMachineEvents {
  connect = 'connect',
  done_connect = donePrefix + 'connect'
}

enum _3DMouseMachineActors {
  connect = 'connect',
}

export const _3DMouseMachine = setup({
  types: {
    context: {} as _3DMouseContext,
    events: {} as | {
      type: _3DMouseMachineEvents.connect,
      data: {
        name: string,
        debug: boolean,
        canvasId: string,
        camera: PerspectiveCamera | OrthographicCamera
      }
    } | {
      type: _3DMouseMachineEvents.done_connect
        output: _3DMouseThreeJS
    }
  },
  actions: {},
  actors: {
    [_3DMouseMachineActors.connect]: fromPromise(
      async ({
        input
      }: {
        input: {
          context: _3DMouseContext,
          name: string,
          debug: boolean,
          canvasId: string,
          camera: PerspectiveCamera | OrthographicCamera
        }
      }): Promise<_3DMouseThreeJS> => {
        if (_3Dconnexion) {
          const message = '_3Dconnexion library missing.'
          console.error(`${prefixForErrors} ${message}`)
          throw (message)
        }
        const the3DMouse = new _3DMouseThreeJS({
            // Name needs to be registered in the python proxy server!
          name: input.name,
          debug: input.debug,
          canvasId: input.canvasId,
          camera: input.camera.clone(),
        })
        await the3DMouse.init3DMouse()
        return the3DMouse
      }
    ),
  },
}).createMachine({
  initial: _3DMouseMachineStates.waitingToConnect,
  context: () => ({
    _3dMouse: null,
  }),
  states: {
    [_3DMouseMachineStates.waitingToConnect]: {
      on: {
        [_3DMouseMachineEvents.connect]: {
          target: _3DMouseMachineStates.connecting,
        },
      },
    },
    [_3DMouseMachineStates.connecting]: {
      on: {},
      invoke: {
        id: _3DMouseMachineActors.connect,
        src: _3DMouseMachineActors.connect,
        input: ({ context, event }) => {
          assertEvent(event, _3DMouseMachineEvents.connect)
          return {
            context,
            name: event.data.name,
            debug: event.data.debug,
            canvasId: event.data.canvasId,
            camera: event.data.camera
          }
        },
        onDone: {
          target: _3DMouseMachineStates.connected,
        },
        onError: {
          target: _3DMouseMachineStates.failedToConnect,
        },
      },
    },
    [_3DMouseMachineStates.connected]: {
      on: {},
    },
    [_3DMouseMachineStates.failedToConnect]: {
      target: _3DMouseMachineStates.waitingToConnect
    },
  },
})
