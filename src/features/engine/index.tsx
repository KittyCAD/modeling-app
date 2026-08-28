import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { StatusDot } from '@kittycad/ui-kit'
import { computed, effect, useComputed } from '@preact/signals'
import { useService } from '@src/app/context'
import { authService } from '@src/contracts/auth'
import { commandService, commandsValueSpec } from '@src/contracts/commands'
import {
  type EngineConnectionState,
  engineConnectionService,
} from '@src/contracts/engine'
import { streamParamsValueSpec } from '@src/contracts/engineScene'
import { projectSessionService } from '@src/contracts/projectSession'
import { statusBarItemsValueSpec } from '@src/contracts/shell'
import { autoConnectOnProjectOpen } from '@src/features/engine/autoConnect'
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
  const commands = useService(commandService)

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
        // One path for every connect affordance, so none can skip sign-in.
        commands.run(
          state.value.status === 'connected'
            ? 'engine.disconnect'
            : 'engine.connect'
        )
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
    /**
     * Contributed, not computed here.
     *
     * The engine builds its render pipeline when the socket opens, so some
     * preferences can only be expressed in the URL. Which ones those are belongs
     * to whoever owns the preference; all the connection does is carry them.
     */
    streamParams: () =>
      Object.assign(
        {},
        ...ctx.valueSpecs.get(streamParamsValueSpec).map((read) => read())
      ),
  })

  /**
   * Wait for auth to finish resolving a stored token.
   *
   * Without this, connecting during startup sees `token === null` while
   * verification is still in flight and reports "no API token available" to
   * someone who is, in fact, about to be signed in.
   */
  const whenAuthSettled = () =>
    new Promise<void>((resolve) => {
      const auth = ctx.services.get(authService)
      if (auth.status.peek() !== 'checking') {
        resolve()
        return
      }
      const stop = effect(() => {
        if (auth.status.value !== 'checking') {
          resolve()
          // Deferred, because disposing an effect from inside its own body is
          // not allowed.
          queueMicrotask(() => stop())
        }
      })
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
    await whenAuthSettled()

    const auth = ctx.services.get(authService)
    if (!auth.token.peek()) {
      auth.requestSignIn(
        'The modeling engine renders your geometry on Zoo, so it needs an account.'
      )
      return
    }
    await connection.connect()
  }

  /**
   * Connect when a project opens with something to render.
   *
   * Deferred by a microtask because reading a service during graph construction
   * is not allowed, and the policy itself lives next door: this is the wiring
   * that says which signals mean "a project with geometry, signed in, idle".
   */
  let stopAutoConnect: (() => void) | null = null
  let disposed = false
  queueMicrotask(() => {
    if (disposed) return

    // Optional: the engine works without any notion of projects, and a build
    // with no session feature has nothing that could open one.
    const sessions = ctx.services.optional(projectSessionService)
    if (!sessions) return

    const auth = ctx.services.get(authService)

    stopAutoConnect = autoConnectOnProjectOpen({
      project: computed(() => sessions.current.value?.project.value.id ?? null),
      executing: computed(() =>
        Boolean(sessions.current.value?.executingBuffer.value)
      ),
      signedIn: computed(() => auth.token.value !== null),
      // Narrowed to the status on purpose: `state` changes with every ping, and
      // an effect reading it whole would wake on each one.
      offline: computed(() => connection.state.value.status === 'offline'),
      connect: () => connection.connect(),
    })
  })

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
        disposed = true
        stopAutoConnect?.()
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
          id: 'engine.fitView',
          title: 'Fit the model in view',
          category: 'Model',
          icon: 'grid',
          enabled: connected,
          /**
           * Frame whatever the engine currently has.
           *
           * Deliberately explicit rather than automatic after execution. KCL
           * *fires* most geometry commands without awaiting them, so
           * `execute` resolving does not mean the engine has built the model —
           * fitting at that moment reliably frames an empty scene. Doing this
           * automatically needs an engine-idle signal, which is not built.
           */
          run: async () => {
            await connection
              .sendCommand({
                type: 'zoom_to_fit',
                object_ids: [],
                padding: 0.2,
                animated: false,
              })
              .catch((error) => {
                console.warn('engine: could not fit the view', error)
              })
          },
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
