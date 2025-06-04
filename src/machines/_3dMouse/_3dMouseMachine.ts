import { assertEvent, assign, fromPromise, setup } from 'xstate'
import { OrthographicCamera, PerspectiveCamera } from 'three'
import { _3DMouseThreeJS } from '@src/lib/externalMouse/external-mouse-threejs'
import { EXTERNAL_MOUSE_ERROR_PREFIX } from '@src/lib/constants'
import {
  _3DMouseContext,
  _3DMouseMachineStates,
  _3DMouseMachineEvents,
  _3DMouseMachineActors
} from '@src/machines/_3dMouse/utils'

function logError(message: string) {
  console.error(`${EXTERNAL_MOUSE_ERROR_PREFIX} ${message}`)
}

export const _3DMouseMachine = setup({
  types: {
    context: {} as _3DMouseContext,
    events: {} as
      | {
          type: _3DMouseMachineEvents.connect
          data: {
            name: string
            debug: boolean
            canvasId: string
            /** Allow null because of internal retry, it will fail if this is null, we cannot have a default camera*/
            camera: PerspectiveCamera | OrthographicCamera | null
          }
        }
      | {
          type: _3DMouseMachineEvents.done_connect
          output: _3DMouseThreeJS
        }
      | {
          type: _3DMouseMachineEvents.error_connect
        },
  },
  actions: {},
  actors: {
    [_3DMouseMachineActors.connect]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: _3DMouseContext
          name: string
          debug: boolean
          canvasId: string
          camera: PerspectiveCamera | OrthographicCamera | null
        }
      }): Promise<_3DMouseThreeJS> => {
        /** * Global variable reference from html script tag loading */
        if (!_3Dconnexion) {
          const message = '_3Dconnexion library missing.'
          logError(message)
          throw message
        }

        /** Check if the canvas is present, it checks in _3DMouseThreeJS as well */
        const canvas: HTMLCanvasElement | null = document.querySelector(
          '#' + input.canvasId
        )
        if (!canvas) {
          const message = `Unable to find canvas with id: ${input.canvasId}`
          logError(message)
          throw message
        }

        /** Make sure the camera is available */
        if (!input.camera) {
          const message = `Unable to find initial client scene camera`
          logError(message)
          throw message
        }

        const the3DMouse = new _3DMouseThreeJS({
          // Name needs to be registered in the python proxy server!
          name: input.name,
          debug: input.debug,
          canvasId: input.canvasId,
          camera: input.camera.clone(),
        })

        /**
         * The mouse class has a bug and we cannot properly await the async xmlHttpRequest
         * we have to poll and hope it connects
         */
        const response = await the3DMouse.init3DMouse(1000 * 2)

        if (response.value === false) {
          logError(response.message)
          the3DMouse.destroy()
          throw response.message
        }

        return the3DMouse
      }
    ),
  },
}).createMachine({
  initial: _3DMouseMachineStates.waitingToConnect,
  context: () => ({
    _3dMouse: null,
    lastConfigurationForConnection: null,
    retries: 0,
    /** retry 3 times before the user needs to manually click a connect button to retry */
    maxRetries: 3,
  }),
  states: {
    [_3DMouseMachineStates.waitingToConnect]: {
      on: {
        [_3DMouseMachineEvents.connect]: {
          target: _3DMouseMachineStates.connecting,
          actions: [
            assign({
              lastConfigurationForConnection: ({ event }) => {
                const { name, debug, canvasId, camera } = event.data
                return { name, debug, canvasId, camera }
              },
            }),
          ],
        },
      },
    },
    [_3DMouseMachineStates.connecting]: {
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
            camera: event.data.camera,
          }
        },
        onDone: {
          target: _3DMouseMachineStates.connected,
          actions: [
            assign({
              _3dMouse: ({ event }) => {
                assertEvent(event, _3DMouseMachineEvents.done_connect)
                return event.output
              },
            }),
          ],
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
      target: _3DMouseMachineStates.waitingToConnect,
      always: [
        {
          guard: ({ context }) =>
            context.retries < context.maxRetries &&
            context.lastConfigurationForConnection !== null,
          target: _3DMouseMachineStates.retryConnection,
          actions: assign({ retries: ({ context }) => context.retries + 1 }),
        },
        {
          target: _3DMouseMachineStates.waitingToConnect,
          /**
           * After we fail 3 times, go back to the initial state and wait for a connect event that is externally triggered via .send()
           * force clear the lastConfigurationForConnection
           */
          actions: [
            assign({ retries: () => 0 }),
            assign({ lastConfigurationForConnection: () => null }),
          ],
        },
      ],
    },
    [_3DMouseMachineStates.retryConnection]: {
      invoke: {
        id: _3DMouseMachineActors.connect,
        src: _3DMouseMachineActors.connect,
        input: ({ context, event }) => {
          assertEvent(event, _3DMouseMachineEvents.error_connect)
          let { name, debug, canvasId, camera } =
            context.lastConfigurationForConnection || {
              name: '',
              debug: false,
              canvasId: '',
              camera: null,
            }
          logError(
            `retrying connection automatically, retry:${context.retries} out of ${context.maxRetries}`
          )
          return {
            context,
            name,
            debug,
            canvasId,
            camera,
          }
        },
        onDone: {
          target: _3DMouseMachineStates.connected,
          actions: [
            assign({
              _3dMouse: ({ event }) => {
                assertEvent(event, _3DMouseMachineEvents.done_connect)
                return event.output
              },
            }),
          ],
        },
        onError: {
          target: _3DMouseMachineStates.failedToConnect,
        },
      },
    },
  },
})
