import { assertEvent, assign, fromPromise, setup } from 'xstate'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'

type _3DMouseContext = {
  _3dMouse: null
}

enum _3DMouseMachineStates {
  waitingToConnect = 'waiting to connect',
  connecting = 'connecting',
  connected = 'connected',
  failedToConnect = 'failed to connect'
}

enum _3DMouseMachineEvents {
  connect = 'connect'
}

enum _3DMouseMachineActors {
  connect = 'connect'
}

export const _3DMouseMachine = setup({
  types: {
    context: {} as _3DMouseContext,
    events: {} as
      | {
        type: _3DMouseMachineEvents.connect
      }
  },
  actions: {},
  actors: {
    [_3DMouseMachineActors.connect]: fromPromise(
      async ({
        input: {context},
      }: {
        input: {
          context: _3DMouseContext
        }
      } ): Promise<void> => {
        console.log("nice")
      }
    ),
  }
}).createMachine({
  initial: _3DMouseMachineStates.waitingToConnect,
  context: () => ({
    _3dMouse: null
  }),
  states: {
    [_3DMouseMachineStates.waitingToConnect]: {
      on: {
        [_3DMouseMachineEvents.connect]: {
          target: _3DMouseMachineStates.connecting
        }
      }
    },
    [_3DMouseMachineStates.connecting]: {
      on: {},
      invoke: {
        id: _3DMouseMachineActors.connect,
        src: _3DMouseMachineActors.connect,
        input: ({context, event}) => {
          assertEvent(event, _3DMouseMachineEvents.connect)
          return {context}
        },
        onDone: {
          target: _3DMouseMachineStates.connected
        },
        onError: {
          target: _3DMouseMachineStates.failedToConnect
        }
      }
    },
    [_3DMouseMachineStates.connected]:{
      on: {

      }
    },
    [_3DMouseMachineStates.failedToConnect]:{
      on: {

      }
    }
  }
})
