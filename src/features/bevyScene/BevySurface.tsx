import { effect, useSignal } from '@preact/signals'
import { setDiagnostics } from '@codemirror/lint'
import { useService, useValueSpec } from '@src/app/context'
import { authService } from '@src/contracts/auth'
import { fileSystemService } from '@src/contracts/fileSystem'
import {
  type ProjectSession,
  projectSessionService,
} from '@src/contracts/projectSession'
import { sceneInteractionsValueSpec } from '@src/contracts/scene'
import { settingsService } from '@src/contracts/settings'
import { themeService } from '@src/contracts/theme'
import { collectProject } from '@src/features/bevyScene/collectProject'
import type { KclProjectPayload } from '@src/features/bevyScene/collectProject'
import { kcleanDiagnosticsForSource } from '@src/features/bevyScene/kcleanDiagnostics'
import { type BevyJobState, startBevy } from '@src/features/bevyScene/loadBevy'
import {
  kcleanServerSetting,
  type ModelingEngineKind,
  modelingEngineSetting,
} from '@src/features/bevyScene/settings'
import { useEffect, useRef } from 'preact/hooks'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import '@src/features/bevyScene/bevyScene.css'

/** The canvas bevy-zoo is told to take over. */
const CANVAS_ID = 'zds-bevy-canvas'

/** Long enough that a held keystroke is one solve, short enough to feel live. */
const PUSH_DEBOUNCE_MS = 500

/**
 * bevy-zoo, rendering into a canvas this app owns.
 *
 * The canvas is created here rather than by Bevy, and its selector handed to the
 * embed build — that is what makes this an embed rather than a hijack, and it is
 * why the backing buffer tracks the panel instead of sitting at winit's default
 * size.
 *
 * Takes pointer events, unlike everything else in the `fill` zone: bevy-zoo's own
 * orbit camera reads the mouse directly. That is also why this renderer provides
 * no `cameraDriverService` — two things steering one camera would fight.
 */
export function BevySurface() {
  const auth = useService(authService)
  const sessions = useService(projectSessionService)
  const fileSystem = useService(fileSystemService)
  const settings = useService(settingsService)
  const theme = useService(themeService)
  const engine = settings.read(modelingEngineSetting)

  const state = useSignal<BevyJobState | null>(null)
  const error = useSignal<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const interactions = useValueSpec(sceneInteractionsValueSpec)

  /**
   * Bind the contributed interactions to the canvas.
   *
   * `EngineStream` does this for the streamed renderer and does not render here,
   * so without it the camera recogniser, the click recogniser and the sketch
   * pointer handling are all attached to nothing — which is exactly what "the
   * camera does not respond" looks like.
   *
   * Keyed on the contribution list rather than the signal, so an interaction
   * installed later still reaches an element that is already mounted.
   */
  const installed = interactions.value

  useEffect(() => {
    const element = canvas.current
    if (!element) return

    const disposers = [...installed]
      .sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
      )
      .map((interaction) => interaction.attach(element))

    return () => {
      for (const dispose of disposers) dispose?.()
    }
  }, [installed])

  useEffect(() => {
    let cancelled = false
    let submitted: KclProjectPayload | null = null
    const started = startBevy({
      canvas: `#${CANVAS_ID}`,
      token: auth.token.value,
      host:
        (import.meta.env?.VITE_KC_API_BASE_URL as string | undefined) ?? null,
      engine,
      kcleanHost: settings.read(kcleanServerSetting),
      darkMode: theme.resolved.peek() === 'dark',
      onState: (next) => {
        state.value = next
        if (engine === 'kclean' && submitted) {
          publishKcleanDiagnostics(sessions.current.peek(), submitted, next)
        }
      },
    })
    started.catch((reason: unknown) => {
      if (cancelled) return
      error.value = reason instanceof Error ? reason.message : String(reason)
    })

    /** Keep the GPU clear color in step with ZDS, including system changes. */
    const stopTheming = effect(() => {
      const darkMode = theme.resolved.value === 'dark'
      void started
        .then((module) => {
          if (!cancelled) module.set_dark_mode(darkMode)
        })
        // Startup failures are already rendered by the handler above.
        .catch(() => {})
    })

    /**
     * Push the project whenever it changes, debounced.
     *
     * The signals are read synchronously so this effect actually depends on
     * them; the assembling is asynchronous and anything it reads after its first
     * await would not be tracked.
     */
    let timer: ReturnType<typeof setTimeout> | null = null
    const stop = effect(() => {
      const session = sessions.current.value
      const executing = session?.executingBuffer.value ?? null
      const fingerprint = session
        ? session.buffers.value
            .filter((buffer) => buffer.languageId.value === 'kcl')
            .map((buffer) => `${buffer.path.value}@${buffer.version.value}`)
            .join('|')
        : ''
      // Read so a file appearing or disappearing counts as a change.
      void session?.files.value
      if (!session || !executing || !fingerprint) return

      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void (async () => {
          const [module, payload] = await Promise.all([
            started,
            collectProject(session, fileSystem),
          ])
          if (cancelled || !payload) return
          submitted = payload
          module.push_project(payload.entrypoint, JSON.stringify(payload.files))
        })().catch((reason: unknown) => {
          if (cancelled) return
          error.value =
            reason instanceof Error ? reason.message : String(reason)
        })
      }, PUSH_DEBOUNCE_MS)
    })

    return () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
      stopTheming()
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, sessions, fileSystem, settings, theme, engine])

  return (
    <div class="zds-bevy">
      <canvas ref={canvas} id={CANVAS_ID} class="zds-bevy__canvas" />
      <BevyNotice engine={engine} state={state.value} error={error.value} />
    </div>
  )
}

/**
 * Publish only against the exact project snapshot Kclean evaluated. A buffer
 * edited while the request was in flight is deliberately left untouched.
 */
function publishKcleanDiagnostics(
  session: ProjectSession | null,
  project: KclProjectPayload,
  state: BevyJobState
) {
  if (!session || (state.status !== 'failed' && state.status !== 'ready'))
    return

  const diagnostics = state.status === 'failed' ? state.diagnostics : []
  for (const [source, contents] of Object.entries(project.files)) {
    const buffer =
      session.bufferForPath(source) ??
      (source === project.entrypoint ? session.executingBuffer.peek() : null)
    if (!buffer || buffer.text.peek() !== contents) continue

    const mapped = kcleanDiagnosticsForSource(
      contents,
      diagnostics.filter((diagnostic) => diagnostic.source === source)
    )
    buffer.dispatch({
      ...setDiagnostics(buffer.state.peek(), mapped),
      annotations: bufferOrigin.of('semantic'),
    })
  }
}

/**
 * What the renderer is doing, in one line.
 *
 * Its own thing rather than the shell's status bar, because these stages —
 * solving, exporting, downloading, loading the scene — are peculiar to a renderer
 * that fetches geometry and draws it here.
 */
function BevyNotice({
  engine,
  state,
  error,
}: {
  engine: ModelingEngineKind
  state: BevyJobState | null
  error: string | null
}) {
  if (error) {
    return (
      <div class="zds-bevy__notice zds-bevy__notice--error" role="status">
        {error}
      </div>
    )
  }
  if (!state || state.status === 'ready') return null
  if (state.status === 'failed') {
    return (
      <div class="zds-bevy__notice zds-bevy__notice--error" role="status">
        {state.message ?? `Failed while ${state.stage ?? 'solving'}.`}
      </div>
    )
  }
  if (state.status === 'idle') return null
  return (
    <div class="zds-bevy__notice" role="status">
      {state.status === 'connecting'
        ? `Connecting to ${engine === 'kclean' ? 'Kclean' : 'Zoo'}…`
        : LABELS[state.status]}
    </div>
  )
}

const LABELS = {
  executing: 'Solving the program…',
  exporting: 'Exporting geometry…',
} as const
