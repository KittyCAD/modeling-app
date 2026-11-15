import { effect, signal } from '@preact/signals-core'
import type { ExecState } from '@src/lang/wasm'
import type { KclSceneResource, OpenKclScene } from '@src/lib/kcl/scene'
import type { KclSourceSnapshot } from '@src/lib/kcl/sources'
import { isErr, reportRejection } from '@src/lib/trap'

type KclConnectionState =
  | { type: 'connecting' | 'ready' | 'closed' }
  | { type: 'error'; error: Error }
/**
 * One attempt to obtain a `KclSceneResource` from `openKclScene`.
 * `recover` replaces this object; `current` checks its identity before an async
 * callback can publish a resource or change the session's connection state.
 */
function opening() {
  return {
    // Passed to `openKclScene`; aborting closes connection work and makes its
    // checks after WASM/SceneInfra startup reject late resources.
    lifetime: new AbortController(),
    // `execute` may arrive before a viewport attaches. `start` resolves this once
    // the connection and native runtime exist; `fail`/`dispose` resolve an `Error`.
    ready: Promise.withResolvers<KclSceneResource | Error>(),
    // Lets queued/running executions return an error immediately on connection
    // loss. The runtime's separate native queue still waits before freeing WASM.
    closed: Promise.withResolvers<Error>(),
    // Set after `execute` calls `frameModel` for the first successful streamed
    // model. Later edits/reattachments retain the user's camera; reconnects start fresh.
    framed: false,
    // `begin` installs the startup deadline; each `execute` has its own run timer.
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  }
}

/**
 * `createKclExecution` retains this session for one executor and disposes it with
 * the executor's Effect scope. `KclScene` only attaches/detaches its DOM element.
 * Connection attempts can be replaced while the executor and document survive.
 */
export function createKclSession(
  open: OpenKclScene,
  onReconnect: () => void = () => {}
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
  const current = (owner: ReturnType<typeof opening>) =>
    !disposed && attempt === owner && state.peek().type !== 'error'
  // Orders session-level execution and preference application. Native execution,
  // exports, and freeing memory are serialized separately by `createKclRuntime`.
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work)
    queue = result.catch(() => undefined)
    return result
  }
  // Hide the failed resource immediately. `start` awaits its asynchronous
  // disposal before opening a replacement, including any pending native work.
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
    state.value = { type: 'error', error }
    owner.lifetime.abort()
    owner.ready.resolve(error)
    owner.closed.resolve(error)
    retire()
  }
  const start = async (
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
  const begin = (size: { width: number; height: number }) => {
    const owner = attempt
    started = true
    owner.timer = setTimeout(
      () => fail(new Error('Opening the KCL scene timed out'), owner),
      60_000
    )
    void start(size, owner)
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
    const stale = resource.peek()?.isConnected?.() === false
    if (state.peek().type !== 'error' && !stale) return
    if (stale) fail(new Error('The scene connection expired'))
    attempt = opening()
    state.value = { type: 'connecting' }
    begin({ width: container.clientWidth, height: container.clientHeight })
    onReconnect() // The KCL registry supplies `executor.refresh` to reload current sources.
  }
  return {
    state,
    resource,
    element,
    /** Retry this mounted view; healthy, detached, and disposed sessions are left alone. */
    reconnect: () => {
      const container = element.parentElement
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
        if (!started) begin(size)
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
      window.addEventListener('focus', focus)
      document.addEventListener('visibilitychange', focus)
      const observer = new ResizeObserver(resized)
      observers.add(observer)
      observer.observe(container)
      resized()
      const detach = () => {
        detachments.delete(detach)
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
      return enqueue(async () => {
        const scene = await owner.ready.promise
        if (isErr(scene)) return scene
        if (!current(owner) || signal.aborted)
          return new Error('KCL execution was cancelled')
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
              await scene.frameModel()
              owner.framed = true
            }
            if (!current(owner) || signal.aborted)
              return new Error('KCL execution was cancelled')
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
