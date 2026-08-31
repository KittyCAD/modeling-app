import { effect, useSignal } from '@preact/signals'
import { useService } from '@src/app/context'
import { authService } from '@src/contracts/auth'
import { fileSystemService } from '@src/contracts/fileSystem'
import { projectSessionService } from '@src/contracts/projectSession'
import { collectProject } from '@src/features/bevyScene/collectProject'
import { type BevyJobState, startBevy } from '@src/features/bevyScene/loadBevy'
import { useEffect } from 'preact/hooks'
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

  const state = useSignal<BevyJobState | null>(null)
  const error = useSignal<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const started = startBevy({
      canvas: `#${CANVAS_ID}`,
      token: auth.token.value,
      host:
        (import.meta.env?.VITE_KC_API_BASE_URL as string | undefined) ?? null,
      onState: (next) => {
        state.value = next
      },
    })
    started.catch((reason: unknown) => {
      if (cancelled) return
      error.value = reason instanceof Error ? reason.message : String(reason)
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
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, sessions, fileSystem])

  return (
    <div class="zds-bevy">
      <canvas id={CANVAS_ID} class="zds-bevy__canvas" />
      <BevyNotice state={state.value} error={error.value} />
    </div>
  )
}

/**
 * What the renderer is doing, in one line.
 *
 * Its own thing rather than the shell's status bar, because these stages —
 * solving, exporting, downloading, loading the scene — are peculiar to a renderer
 * that fetches geometry and draws it here.
 */
function BevyNotice({
  state,
  error,
}: {
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
      {LABELS[state.status]}
    </div>
  )
}

const LABELS = {
  connecting: 'Connecting to Zoo…',
  executing: 'Solving the program…',
  exporting: 'Exporting geometry…',
} as const
