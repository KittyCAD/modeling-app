import { canAutomaticallyRecoverEngine } from '@src/lib/engineConnection/recovery'
import type { CameraViewState } from '@kittycad/lib'
import { SceneDisconnected } from '@src/lib/kcl/scene/recovery'
import { effect, signal } from '@preact/signals-core'
import type { ExecState } from '@src/lang/wasm'
import type { KclSceneResource, OpenKclScene } from '@src/lib/kcl/scene/open'
import type { KclSourceSnapshot } from '@src/lib/kcl/execution/sources'
import { isErr, reportRejection } from '@src/lib/trap'

type KclConnectionState =
  | { type: 'connecting' | 'ready' | 'closed' | 'idle' }
  | { type: 'error'; error: Error }
/**
 * One attempt to obtain a `KclSceneResource` from `openKclScene`.
 * `replaceScene` replaces this object; `current` checks its identity before an async
 * callback can publish a resource or change the session's connection state.
 */
function opening() {
  return {
    // Passed to `openKclScene`; aborting closes connection work and makes its
    // checks after WASM/SceneInfra startup reject late resources.
    lifetime: new AbortController(),
    // `execute` may arrive before a viewport attaches. `openAndAttachScene`
    // resolves this with the connection and runtime; `fail`/`dispose` resolve an `Error`.
    ready: Promise.withResolvers<KclSceneResource | Error>(),
    // Lets queued/running executions return an error immediately on connection
    // loss. The runtime's separate native queue still waits before freeing WASM.
    closed: Promise.withResolvers<Error>(),
    // Set after `execute` calls `frameModel` for the first successful streamed
    // model. Later edits/reattachments and recovered connections retain the user's camera.
    framed: false,
    // `beginOpeningAttempt` installs the startup deadline; each `execute` has
    // its own run timer.
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  }
}

/**
 * Owns one Modeling view's scene across presentation attachments and reconnects.
 * The view's mode context creates and disposes the session; `KclScene` attaches
 * its DOM element. Detaching that presentation preserves the connection, native
 * runtime, and camera for a later attachment.
 *
 * The first attachment with usable dimensions begins opening the scene. `execute`
 * can arrive earlier: it captures the current opening attempt and waits for that
 * attempt's `ready` promise. Execution and preference updates share a session
 * queue; the native runtime separately serializes access to its WASM memory.
 *
 * Recovery replaces the opening attempt and scene, while retaining the session
 * and saved camera. Callbacks check their captured attempt before publishing
 * results, so a retired connection cannot replace the current scene.
 */
export function createKclSession(
  open: OpenKclScene,
  onSceneReplaced: () => void = () => {},
  isBusy: () => boolean = () => false
) {
  const element = document.createElement('div')
  Object.assign(element.style, {
    width: '100%',
    height: '100%',
    position: 'relative',
  })
  const state = signal<KclConnectionState>({ type: 'connecting' })
  const resource = signal<KclSceneResource | undefined>(undefined)
  let attempt = opening()
  const observers = new Set<ResizeObserver>()
  const detachments = new Set<() => void>()
  let started = false
  let disposed = false
  let queue: Promise<unknown> = Promise.resolve()
  let retired: Promise<void> | undefined
  let stopSettings: (() => void) | undefined
  // Renderer swaps preserve the full camera. Recovery continues to honor a
  // projection preference changed while the connection was unavailable.
  let savedCamera:
    | { view: CameraViewState; projection: 'snapshot' | 'settings' }
    | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryCount = 0
  let lastInput = Date.now()
  const cancelRetry = () => {
    clearTimeout(retryTimer)
    retryTimer = undefined
  }
  const rememberCamera = (projection: 'snapshot' | 'settings' = 'settings') => {
    const active = resource.peek()
    if (
      active &&
      (attempt.framed || (active.presentation === 'local' && !savedCamera))
    )
      savedCamera = { view: active.snapshotCamera(), projection }
  }
  const retry = (consumeBudget = true) => {
    cancelRetry()
    if (
      disposed ||
      !canAutomaticallyRecoverEngine(retryCount + 1) ||
      navigator.onLine === false
    )
      return
    const container = element.parentElement
    if (!container || document.visibilityState === 'hidden') return
    // zds-performance-exception: connection-retry -- Back off automatic scene reconnection after transport failures; explicit reconnect remains immediate.
    retryTimer = setTimeout(
      () => {
        recover(container)
        if (consumeBudget) retryCount += 1
      },
      500 * (retryCount + 1)
    )
  }
  const current = (owner: ReturnType<typeof opening>) =>
    !disposed &&
    attempt === owner &&
    !owner.lifetime.signal.aborted &&
    state.peek().type !== 'error'
  // Orders session-level execution and preference application. Native execution,
  // exports, and freeing memory are serialized separately by `createKclRuntime`.
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work)
    queue = result.catch(() => undefined)
    return result
  }
  // Hide the failed resource immediately, but retain its disposal promise so
  // opening a replacement waits for pending native work to finish.
  const retire = () => {
    stopSettings?.()
    stopSettings = undefined
    const active = resource.peek()
    resource.value = undefined
    retired = Promise.all([retired, active?.dispose()])
      .then(() => undefined)
      .catch(reportRejection)
  }
  const fail = (error: Error, owner = attempt) => {
    if (!current(owner)) return
    clearTimeout(owner.timer)
    const requested =
      error instanceof SceneDisconnected &&
      error.details.reconnectRequested === true
    if (requested) retryCount = 0
    rememberCamera()
    state.value = { type: 'error', error }
    owner.lifetime.abort()
    owner.ready.resolve(error)
    owner.closed.resolve(error)
    retire()
    if (
      (error instanceof SceneDisconnected && error.retryable) ||
      (retryCount > 0 &&
        !(error instanceof SceneDisconnected && !error.retryable))
    )
      retry(!requested)
  }
  // Wait for the previous runtime to release its native resources before opening
  // a replacement. A result that arrives after cancellation still needs disposal.
  const openAndAttachScene = async (
    size: { width: number; height: number },
    owner: ReturnType<typeof opening>
  ) => {
    try {
      if (retired) await retired
      if (!current(owner)) return
      const opened = await open(size, owner.lifetime.signal, (error) =>
        fail(error, owner)
      )
      if (isErr(opened)) {
        fail(opened, owner)
        return
      }
      if (!current(owner)) {
        await opened.dispose()
        return
      }
      clearTimeout(owner.timer)
      element.appendChild(opened.element)
      resource.value = opened
      state.value = { type: 'ready' }
      lastInput = Date.now()
      owner.ready.resolve(opened)
      stopSettings = effect(() => {
        void opened.preferences.camera.value
        void opened.preferences.appearance.value
        void enqueue(async () => {
          if (current(owner)) await opened.applySettings()
        }).catch((cause) =>
          fail(
            isErr(cause)
              ? cause
              : new Error('Unable to apply scene settings', { cause }),
            owner
          )
        )
      })
      await opened.resize(size)
      if (current(owner)) opened.resume()
    } catch (cause) {
      fail(
        isErr(cause) ? cause : new Error('Unable to open the scene', { cause }),
        owner
      )
    }
  }
  // Arm the deadline before asynchronous opening, including any wait for the
  // previous scene's disposal. `started` prevents resize events from launching
  // the initial attempt repeatedly; `recover` explicitly creates later attempts.
  const beginOpeningAttempt = (size: { width: number; height: number }) => {
    const owner = attempt
    started = true
    // zds-performance-exception: network-deadline -- Fail a scene opening that never settles, including disposal of the previous scene; successful startup proceeds immediately.
    owner.timer = setTimeout(
      () => fail(new Error('Opening the KCL scene timed out'), owner),
      60_000
    )
    void openAndAttachScene(size, owner)
  }
  // A renderer change needs a new connection even when the old one is healthy.
  // Keep the session and camera, and settle calls waiting on the retired attempt.
  const replaceScene = (projection: 'snapshot' | 'settings' = 'settings') => {
    if (disposed) return
    cancelRetry()
    rememberCamera(projection)
    const previous = attempt
    clearTimeout(previous.timer)
    previous.lifetime.abort()
    const error = new Error('The scene connection was replaced')
    previous.ready.resolve(error)
    previous.closed.resolve(error)
    retire()
    attempt = opening()
    started = false
    state.value = { type: 'connecting' }
    const container = element.parentElement
    if (container && container.clientWidth >= 4 && container.clientHeight >= 4)
      beginOpeningAttempt({
        width: container.clientWidth,
        height: container.clientHeight,
      })
    onSceneReplaced()
  }
  // Manual retry, viewport resize, and focus recovery use the same checks.
  // Only an attached viewport with a usable size can replace a failed/stale resource.
  const recover = (container: HTMLElement) => {
    if (
      disposed ||
      element.parentElement !== container ||
      container.clientWidth < 4 ||
      container.clientHeight < 4
    )
      return
    if (!canAutomaticallyRecoverEngine(retryCount + 1)) return
    const failed = state.peek()
    if (
      failed.type === 'error' &&
      failed.error instanceof SceneDisconnected &&
      !failed.error.retryable
    )
      return
    const stale = resource.peek()?.isConnected?.() === false
    if (failed.type !== 'error' && failed.type !== 'idle' && !stale) return
    if (stale) fail(new Error('The scene connection expired'))
    replaceScene()
  }
  const restoreSavedCamera = async (
    scene: KclSceneResource,
    owner: ReturnType<typeof opening>
  ) => {
    const camera = savedCamera
    if (!camera) return false
    await scene.restoreCamera({
      ...camera.view,
      is_ortho:
        camera.projection === 'snapshot'
          ? camera.view.is_ortho
          : scene.preferences.camera.peek().cameraProjection === 'orthographic',
    })
    if (
      scene.presentation === 'local' &&
      current(owner) &&
      savedCamera === camera
    )
      savedCamera = undefined
    return true
  }
  // zds-performance-exception: idle-lifecycle -- Release an inactive streamed connection after its configured idle limit without postponing input or execution.
  const idle = setInterval(() => {
    const active = resource.peek()
    const timeout = active?.preferences.idleTimeout.peek()
    if (
      !active ||
      active.presentation !== 'streamed' ||
      !timeout ||
      state.peek().type !== 'ready'
    )
      return
    if (active.runtime.executing.peek() || isBusy()) {
      lastInput = Date.now()
      return
    }
    if (Date.now() - lastInput < timeout) return
    retryCount = 0
    rememberCamera()
    state.value = { type: 'idle' }
    attempt.lifetime.abort()
    attempt.closed.resolve(new Error('The scene is idle'))
    retire()
  }, 1000)
  return {
    state,
    resource,
    element,
    /** Replace renderer-bound resources while retaining this view's camera and executor input. */
    replaceScene: () => {
      retryCount = 0
      replaceScene('snapshot')
    },
    /** Retry this mounted view; healthy, detached, and disposed sessions are left alone. */
    reconnect: () => {
      const container = element.parentElement
      retryCount = 0
      const failed = state.peek()
      if (failed.type === 'error' && failed.error instanceof SceneDisconnected)
        state.value = { type: 'error', error: new Error(failed.error.message) }
      if (container) recover(container)
    },
    /** Attach the viewport and its listeners. The returned detach function preserves the scene and model. */
    attach: (container: HTMLElement) => {
      container.appendChild(element)
      resource.peek()?.resume()
      const resized = () => {
        if (disposed || element.parentElement !== container) return
        const size = {
          width: container.clientWidth,
          height: container.clientHeight,
        }
        if (size.width < 4 || size.height < 4) return
        recover(container)
        if (!started) beginOpeningAttempt(size)
        else if (state.peek().type === 'ready') {
          const owner = attempt
          void resource
            .peek()
            ?.resize(size)
            .catch((cause) =>
              fail(
                isErr(cause)
                  ? cause
                  : new Error('Unable to resize scene', { cause }),
                owner
              )
            )
        }
      }
      const focus = () => {
        if (document.visibilityState !== 'hidden') recover(container)
      }
      const online = () => {
        retryCount = 0
        recover(container)
      }
      const offline = () => {
        if (state.peek().type === 'ready')
          fail(new SceneDisconnected('The network is offline.'))
      }
      const input = () => {
        lastInput = Date.now()
        if (state.peek().type === 'idle') recover(container)
      }
      const inputEvents = [
        'pointerdown',
        'pointermove',
        'keydown',
        'wheel',
        'touchstart',
      ]
      for (const event of inputEvents) container.addEventListener(event, input)
      window.addEventListener('online', online)
      window.addEventListener('offline', offline)
      window.addEventListener('focus', focus)
      document.addEventListener('visibilitychange', focus)
      const observer = new ResizeObserver(resized)
      observers.add(observer)
      observer.observe(container)
      resized()
      const detach = () => {
        detachments.delete(detach)
        cancelRetry()
        for (const event of inputEvents)
          container.removeEventListener(event, input)
        window.removeEventListener('online', online)
        window.removeEventListener('offline', offline)
        window.removeEventListener('focus', focus)
        document.removeEventListener('visibilitychange', focus)
        observer.disconnect()
        observers.delete(observer)
        if (element.parentElement === container) element.remove()
      }
      detachments.add(detach)
      return detach
    },
    /** Run against the captured connection attempt; a reconnect cannot redirect queued old source into its replacement. */
    execute: (
      sources: KclSourceSnapshot,
      signal: AbortSignal
    ): Promise<{ result: ExecState } | Error> => {
      const owner = attempt
      lastInput = Date.now()
      return enqueue(async () => {
        const scene = await owner.ready.promise
        if (isErr(scene)) return scene
        if (!current(owner) || signal.aborted)
          return new Error('KCL execution was cancelled')
        // zds-performance-exception: network-deadline -- Fail an execution that never completes so its scene can recover; successful results do not wait for this clock.
        const timer = setTimeout(
          () =>
            fail(
              new Error(
                'KCL execution timed out. Return to this view to reconnect.'
              ),
              owner
            ),
          60_000
        )
        try {
          const work = async () => {
            const result = await scene.runtime.execute(sources)
            if (!current(owner) || signal.aborted)
              return new Error('KCL execution was cancelled')
            await scene.applySettings()
            if (!owner.framed && scene.presentation === 'streamed') {
              if (!(await restoreSavedCamera(scene, owner)))
                await scene.frameModel()
              owner.framed = true
            }
            if (!current(owner) || signal.aborted)
              return new Error('KCL execution was cancelled')
            if (scene.presentation === 'local')
              await restoreSavedCamera(scene, owner)
            if (!current(owner) || signal.aborted)
              return new Error('KCL execution was cancelled')
            lastInput = Date.now()
            return { result }
          }
          // Report a closed connection without waiting for a hung native call.
          // `retire` still waits for `runtime.dispose` before native memory is freed.
          return await Promise.race([work(), owner.closed.promise])
        } catch (cause) {
          return isErr(cause)
            ? cause
            : new Error('KCL execution failed', { cause })
        } finally {
          clearTimeout(timer)
        }
      })
    },
    /** Close waiting calls/listeners synchronously and initiate resource disposal through `retire`. */
    dispose: () => {
      if (disposed) return
      disposed = true
      savedCamera = undefined
      cancelRetry()
      clearInterval(idle)
      clearTimeout(attempt.timer)
      for (const detach of [...detachments]) detach()
      for (const observer of observers) observer.disconnect()
      observers.clear()
      attempt.lifetime.abort()
      const error = new Error('The executor closed')
      attempt.ready.resolve(error)
      attempt.closed.resolve(error)
      retire()
      state.value = { type: 'closed' }
      element.remove()
    },
  }
}
export type KclSession = ReturnType<typeof createKclSession>
