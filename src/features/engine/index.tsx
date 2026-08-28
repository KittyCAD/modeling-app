import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, useComputed } from '@preact/signals'
import { StatusDot } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { authService } from '@src/contracts/auth'
import { commandsValueSpec } from '@src/contracts/commands'
import {
  type EngineConnectionState,
  engineConnectionService,
} from '@src/contracts/engine'
import { statusBarItemsValueSpec } from '@src/contracts/shell'
import { createEngineConnection } from '@src/features/engine/createEngineConnection'
import { setWasmEngineTransport } from '@src/wasm/bridge'

/**
 * Where the engine websocket lives.
 *
 * Read from the same environment variable the existing app uses, so a checkout
 * configured for one is configured for both.
 */
function engineBaseUrl(): string {
  return (
    (import.meta.env?.VITE_KC_API_WS_MODELING_URL as string | undefined) ?? ''
  )
}

const toneFor = (state: EngineConnectionState) => {
  switch (state.status) {
    case 'connected':
      return 'ok'
    case 'connecting':
      return 'busy'
    case 'failed':
      return 'fault'
    default:
      return 'idle'
  }
}

const labelFor = (state: EngineConnectionState) => {
  if (state.status === 'connecting') return state.stage ?? 'connecting'
  if (state.status === 'failed') return 'failed'
  if (state.status === 'connected') {
    return state.pingMs === null ? 'connected' : `${state.pingMs}ms`
  }
  return 'offline'
}

/**
 * Engine state in the status bar.
 *
 * Reports the connecting *stage*, not just "connecting": when it stalls, knowing
 * whether it stopped at the websocket, at auth, or at ICE is the whole
 * diagnosis. Clicking connects or disconnects, so recovery never needs the
 * command palette.
 */
function EngineField() {
  const engine = useService(engineConnectionService)
  const auth = useService(authService)

  const state = useComputed(() => engine.state.value)

  const title = useComputed(() => {
    if (state.value.error) return state.value.error
    if (state.value.status === 'offline') {
      return auth.token.value
        ? 'Click to connect to the modeling engine'
        : 'No API token is available, so the engine cannot be reached'
    }
    return state.value.apiCallId
      ? `Engine session ${state.value.apiCallId}`
      : 'Connected to the modeling engine'
  })

  return (
    <button
      type="button"
      class="zds-status-button"
      title={title.value}
      onClick={() => {
        if (state.value.status === 'connected') {
          engine.disconnect()
          return
        }
        // A rejection here is already reflected in the status field, so there is
        // nothing useful to do with it beyond not crashing.
        void engine.connect().catch(() => {})
      }}
    >
      <StatusDot
        tone={toneFor(state.value)}
        label={`Engine: ${labelFor(state.value)}`}
      />
      <span>engine</span>
      <span class="zds-status-field__value">{labelFor(state.value)}</span>
    </button>
  )
}

/**
 * Owns the engine connection.
 *
 * Also registers it as the WASM engine transport, which is what closes the loop
 * opened when the FFI boundary was rebuilt: `EngineCommandManager` had no
 * provider and reported "not connected to the modeling engine". Now KCL's
 * runtime sends through this connection.
 */
export default defineRegistryItemFactory((ctx) => {
  const connection = createEngineConnection({
    baseUrl: engineBaseUrl(),
    token: () => ctx.services.get(authService).token.peek(),
  })

  /**
   * Connect, asking for credentials first if there are none.
   *
   * This is where "gate only what needs the network" actually lands: the app is
   * fully usable signed out, and the sign-in screen appears at the moment
   * something genuinely needs an account — with the reason attached, so it does
   * not look like an arbitrary demand.
   */
  const connectOrSignIn = async () => {
    const auth = ctx.services.get(authService)
    if (!auth.token.peek()) {
      auth.requestSignIn(
        'The modeling engine renders your geometry on Zoo, so it needs an account.'
      )
      return
    }
    await connection.connect()
  }

  const releaseTransport = setWasmEngineTransport({
    fireModelingCommand: (request) => connection.fire(request),
    sendModelingCommand: (request) => connection.send(request),
    startNewSession: () => connection.startNewSession(),
  })

  const connected = computed(
    () => connection.state.value.status === 'connected'
  )

  return {
    model: connection,
    item: defineRuntimeRegistryItem({
      id: 'engine',
      dispose: () => {
        releaseTransport()
        connection.dispose()
      },
      providesServices: [provideService(engineConnectionService, connection)],
      provides: [
        provide(statusBarItemsValueSpec, {
          id: 'engine.status',
          zone: 'end',
          order: -10,
          render: () => <EngineField />,
        }),
        provide(commandsValueSpec, {
          id: 'engine.connect',
          title: 'Connect to the modeling engine',
          category: 'Model',
          icon: 'play',
          enabled: computed(() => !connected.value),
          run: connectOrSignIn,
        }),
        provide(commandsValueSpec, {
          id: 'engine.disconnect',
          title: 'Disconnect from the modeling engine',
          category: 'Model',
          icon: 'unplugged',
          enabled: connected,
          run: () => connection.disconnect(),
        }),
        provide(commandsValueSpec, {
          id: 'engine.newSession',
          title: 'Restart the engine session',
          category: 'Model',
          icon: 'refresh',
          enabled: connected,
          run: () => connection.startNewSession(),
        }),
      ],
    }),
  }
}, 'engine')
