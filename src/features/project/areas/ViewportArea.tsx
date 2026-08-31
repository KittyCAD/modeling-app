import { Button, EmptyState, Spinner } from '@kittycad/ui-kit'
import { useComputed } from '@preact/signals'
import { useService } from '@src/app/context'
import { authService } from '@src/contracts/auth'
import { commandService } from '@src/contracts/commands'
import { engineConnectionService } from '@src/contracts/engine'
import {
  executionCoordinatorService,
  idleExecutionState,
} from '@src/contracts/execution'
import { projectSessionService } from '@src/contracts/projectSession'
import { settingsService } from '@src/contracts/settings'
import { rendererSetting } from '@src/features/bevyScene/settings'
import { EngineStream } from '@src/features/engineScene/EngineStream'
import { SceneZones } from '@src/features/engineScene/SceneZones'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import '../project.css'

/**
 * Where geometry appears.
 *
 * Four distinct states, and they mean genuinely different things. Collapsing
 * them into one "no model" message is how someone ends up unable to tell which
 * of them they are looking at:
 *
 * - nothing executing — a choice the user made and can undo
 * - running — wait
 * - the KCL does not parse — their problem, and fixable, with the count of what
 *   is wrong
 * - parses, but no engine — infrastructure, and nothing they can do about it
 */
/**
 * The viewport container.
 *
 * Always mounted, whatever state execution or the engine is in, because it is
 * what reports the panel size — and the engine allocates its render target when
 * the connection is made, so the size has to be known before connecting rather
 * than after the stream appears.
 */
function ViewportFrame({
  children,
  grid = true,
}: {
  children: ComponentChildren
  grid?: boolean
}) {
  const engine = useService(engineConnectionService)
  const auth = useService(authService)
  const commands = useService(commandService)

  /** One path for every "connect" affordance, so sign-in is never skipped. */
  const connect = () => commands.run('engine.connect')
  const host = useRef<HTMLDivElement>(null)

  /**
   * Report the panel's size, whenever it changes.
   *
   * This is the only thing that tells the engine how big to render, so it has to
   * survive everything that changes the panel: a splitter dragged, a rail
   * toggled, the window resized or maximised, the app entering full screen.
   * Observing the element covers all of them without knowing about any of them.
   *
   * Reads the element rather than the entry's `contentRect`, which is a snapshot
   * from when the observation was queued and can be a frame behind by the time a
   * coalesced batch is delivered.
   */
  useEffect(() => {
    const element = host.current
    if (!element || typeof ResizeObserver === 'undefined') return

    let frame: number | null = null
    const observer = new ResizeObserver(() => {
      // Deferred to the next frame: reporting synchronously from inside the
      // callback is what produces "ResizeObserver loop completed with
      // undelivered notifications" as soon as anything downstream reads layout.
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        engine.reportViewportSize({
          width: element.clientWidth,
          height: element.clientHeight,
        })
      })
    })
    observer.observe(element)

    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [engine])

  return (
    <div
      ref={host}
      class={grid ? 'zds-viewport zds-grid-field' : 'zds-viewport'}
    >
      {children}
      {/*
        Contributed controls over the scene — the toolbar, and whatever else is
        installed. Inside the frame rather than beside the stream, so they are on
        screen in every state the viewport has: a toolbar that appears only once
        frames arrive vanishes exactly when someone is working out why they have
        not.
      */}
      <SceneZones />
    </div>
  )
}

export function ViewportArea() {
  const sessions = useService(projectSessionService)
  const coordinator = useService(executionCoordinatorService)
  const engine = useService(engineConnectionService)
  const auth = useService(authService)
  const commands = useService(commandService)
  const settings = useService(settingsService)

  /** One path for every "connect" affordance, so sign-in is never skipped. */
  const connect = () => commands.run('engine.connect')

  const renderer = useComputed(() => settings.value(rendererSetting).value)
  const session = useComputed(() => sessions.current.value)
  const executing = useComputed(
    () => session.value?.executingBuffer.value ?? null
  )
  const kclBuffers = useComputed(
    () =>
      session.value?.buffers.value.filter(
        (buffer) => buffer.languageId.value === 'kcl'
      ) ?? []
  )
  const state = useComputed(() =>
    executing.value
      ? coordinator.stateFor(executing.value.id).value
      : idleExecutionState('none')
  )
  const engineState = useComputed(() => engine.state.value)
  const streaming = useComputed(() => engine.mediaStream.value !== null)

  /**
   * A local renderer draws its own surface, so none of the states below apply.
   *
   * The frame stays — it owns the `ResizeObserver` — and so do the scene zones,
   * which is where that surface is contributed from. What goes is the stream and
   * the engine's empty states: "not connected to the engine" underneath an opaque
   * canvas is a puzzle, not a message.
   *
   * Below every hook rather than beside the service reads, because the value
   * flips once settings hydrate from disk — returning early above the `useComputed`
   * calls would change how many hooks this component ran between two renders.
   *
   * The import direction here is wrong: `project` should not know a particular
   * renderer's setting. The right answer is a renderer-contributed surface this
   * asks for by role, and it belongs with the camera-driver increment rather than
   * being paid for by a spike.
   */
  if (renderer.value === 'bevy') {
    return <ViewportFrame grid={false}>{null}</ViewportFrame>
  }

  /**
   * Once the stream is live it stays on screen.
   *
   * Every other state here is an empty state *instead of* the viewport; a
   * connected engine means the viewport has real content, and messages about
   * execution belong on top of it rather than in place of it.
   */
  if (streaming.value) {
    return (
      <ViewportFrame grid={false}>
        <EngineStream engine={engine} />
        {state.value.status === 'failed' || errorCount(state.value) > 0 ? (
          <div class="zds-viewport__notice" role="status">
            {state.value.status === 'failed'
              ? (state.value.error ?? 'Execution failed.')
              : `${errorCount(state.value)} error${errorCount(state.value) === 1 ? '' : 's'} in ${executing.value?.name.value ?? 'this file'}`}
          </div>
        ) : null}
      </ViewportFrame>
    )
  }

  if (!executing.value) {
    return (
      <ViewportFrame>
        <EmptyState
          scale="page"
          icon="cube"
          eyebrow="Model"
          title="No file is executing"
          description="Choose which file drives the model. It does not have to be the file you are reading."
          actions={
            kclBuffers.value.length > 0 ? (
              <Button
                icon="play"
                label={`Execute ${kclBuffers.value[0].name.value}`}
                onClick={() =>
                  session.value?.setExecutingBuffer(kclBuffers.value[0].id)
                }
              />
            ) : undefined
          }
        />
      </ViewportFrame>
    )
  }

  const name = executing.value.name.value
  const errors = errorCount(state.value)

  if (state.value.status === 'running' || state.value.status === 'queued') {
    return (
      <ViewportFrame>
        <EmptyState
          scale="page"
          eyebrow="Model"
          title={`Running ${name}`}
          description="Reading the program and checking it for errors."
          actions={<Spinner label={`Executing ${name}`} size="large" />}
        />
      </ViewportFrame>
    )
  }

  if (state.value.status === 'failed') {
    return (
      <ViewportFrame>
        <EmptyState
          scale="page"
          icon="warning"
          eyebrow="Model"
          title="Could not run this file"
          description={state.value.error ?? 'The execution engine failed.'}
        />
      </ViewportFrame>
    )
  }

  if (errors > 0) {
    return (
      <ViewportFrame>
        <EmptyState
          scale="page"
          icon="error"
          eyebrow="Model"
          title={`${name} has ${errors} error${errors === 1 ? '' : 's'}`}
          description="The errors are marked in the editor's gutter. Geometry appears once the program parses."
        />
      </ViewportFrame>
    )
  }

  if (engineState.value.status === 'connecting') {
    return (
      <ViewportFrame>
        <EmptyState
          scale="page"
          eyebrow="Model"
          title="Connecting to the modeling engine"
          description={`Negotiating the video stream (${engineState.value.stage ?? 'starting'}).`}
          actions={<Spinner label="Connecting to the engine" size="large" />}
        />
      </ViewportFrame>
    )
  }

  if (engineState.value.status === 'failed') {
    return (
      <ViewportFrame>
        <EmptyState
          scale="page"
          icon="unplugged"
          eyebrow="Model"
          title="Could not reach the modeling engine"
          description={engineState.value.error ?? 'The connection failed.'}
          actions={
            <Button icon="refresh" label="Try again" onClick={connect} />
          }
        />
      </ViewportFrame>
    )
  }

  return (
    <ViewportFrame>
      <EmptyState
        scale="page"
        icon="unplugged"
        eyebrow="Model"
        title="Not connected to the engine"
        description={
          state.value.runCount > 0
            ? `${name} parses cleanly. Connect to the engine to see geometry.`
            : `${name} is set to execute. Connect to the engine to see geometry.`
        }
        actions={
          <Button
            variant="primary"
            icon="play"
            label={
              auth.token.value ? 'Connect to the engine' : 'Sign in to connect'
            }
            onClick={connect}
          />
        }
      />
    </ViewportFrame>
  )
}

/** Errors, as opposed to warnings, in an execution result. */
function errorCount(state: { diagnostics: readonly { severity: string }[] }) {
  return state.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error'
  ).length
}
