import type { WebSocketRequest } from '@kittycad/lib'
import type { CreateViewerKclRuntime } from '@src/lib/kcl/runtime'
import type { KclModelSnapshot } from '@src/lib/kcl/stdlibExtrude'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program, ExecState } from '@src/lang/wasm'
import { readKclResult } from '@src/lib/kcl/result'
import { effect, signal, type ReadonlySignal } from '@preact/signals-core'
import { kclSceneCommands, type KclSceneSettings } from '@src/lib/kcl/settings'
import { isErr, reportRejection } from '@src/lib/trap'

/** A project snapshot uses the same paths as mainKclPathName and relative import resolution. */
export type KclSources = string | Map<string, string>

/** The viewer owns transport and video; the session sequences KCL submissions. */
export interface KclStreamView extends EventTarget {
  el: HTMLElement
  start: () => void
  rtc?: EventTarget & {
    send: (message: string) => Promise<unknown>
  }
  deconstructor: () => unknown
}
export type CreateKclStreamView = (size: {
  width: number
  height: number
}) => Promise<KclStreamView | Error>

type ConnectionState =
  | { type: 'connecting' | 'ready' | 'closed' }
  | { type: 'error'; error: Error }

/** One persistent engine connection per executor, independent of execution snapshots and React mounts. */
export function createKclSession(
  createView: CreateKclStreamView,
  createRuntime: CreateViewerKclRuntime,
  settings?: ReadonlySignal<KclSceneSettings>
) {
  const element = document.createElement('div')
  element.className = 'h-full min-h-0 min-w-0 w-full overflow-hidden'
  const state = signal<ConnectionState>({ type: 'connecting' })
  const ready = Promise.withResolvers<KclStreamView | Error>()
  const closed = Promise.withResolvers<Error>()
  const snapshot = signal<KclModelSnapshot | undefined>(undefined)
  let runtime: Awaited<ReturnType<CreateViewerKclRuntime>> | undefined
  let runtimePromise: ReturnType<CreateViewerKclRuntime> | undefined
  let view: KclStreamView | undefined
  let started = false
  let disposed = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let queue = Promise.resolve()
  let framed = false
  let latestSettings: KclSceneSettings | undefined
  let appliedSettings: KclSceneSettings | undefined
  const enqueue = <T>(work: () => Promise<T>) => {
    const run = queue.then(work)
    queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }
  const layoutObservers = new Set<ResizeObserver>()

  const stopViewer = () => {
    if (!view) return
    const current = view
    view = undefined
    current.removeEventListener('ready', onReady)
    current.rtc?.removeEventListener('close', onDisconnect)
    Promise.resolve(current.deconstructor()).catch(reportRejection)
    current.el.remove()
  }
  const fail = (error: Error) => {
    if (disposed || state.peek().type === 'error') return
    clearTimeout(timeout)
    state.value = { type: 'error', error }
    ready.resolve(error)
    closed.resolve(error)
    snapshot.value = undefined
    stopViewer()
    void queue
      .then(async () => (await runtimePromise)?.dispose())
      .catch(reportRejection)
  }
  const unavailable = () => disposed || state.peek().type === 'error'
  const onDisconnect = () =>
    fail(
      new Error(
        'The engine disconnected. Close this view and open it again to reconnect.'
      )
    )
  const applySettings = async (connected: KclStreamView, force = false) => {
    const next = latestSettings
    if (!next || !connected.rtc || unavailable()) return
    const commands = kclSceneCommands(next, appliedSettings, force)
    if (isErr(commands)) return commands
    for (const cmd of commands) {
      if (unavailable()) return
      const response = await Promise.race([
        connected.rtc.send(
          JSON.stringify({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd,
          })
        ),
        closed.promise,
      ])
      const result = readKclResult(response)
      if (isErr(result)) return result
    }
    if (!unavailable()) appliedSettings = next
  }
  const scheduleSettings = () => {
    const expected = latestSettings
    if (state.peek().type !== 'ready') return
    enqueue(async () => {
      if (!view || unavailable() || latestSettings !== expected) return
      const timeout = setTimeout(
        () => fail(new Error('Updating engine settings timed out')),
        30_000
      )
      try {
        const error = await applySettings(view)
        if (isErr(error)) fail(error)
      } catch (cause) {
        fail(
          isErr(cause)
            ? cause
            : new Error('Unable to update engine settings', { cause })
        )
      } finally {
        clearTimeout(timeout)
      }
    }).catch(reportRejection)
  }
  const unsubscribeSettings = settings
    ? effect(() => {
        const next = settings.value
        if (JSON.stringify(next) === JSON.stringify(latestSettings)) return
        latestSettings = next
        scheduleSettings()
      })
    : () => {}
  const onReady = () => {
    if (disposed || state.peek().type === 'error' || !view) return
    if (!view.rtc) {
      fail(new Error('The viewer connected without an engine session'))
      return
    }
    clearTimeout(timeout)
    view.rtc.addEventListener('close', onDisconnect, { once: true })
    state.value = { type: 'ready' }
    runtimePromise = createRuntime(view.rtc.send.bind(view.rtc)).then(
      (value) => {
        runtime = value
        return value
      }
    )
    void runtimePromise?.catch(fail)
    ready.resolve(view)
    scheduleSettings()
  }
  const start = async (size: { width: number; height: number }) => {
    timeout = setTimeout(
      () =>
        fail(
          new Error(
            'Connecting to the engine timed out. Close this view and try again.'
          )
        ),
      30_000
    )
    try {
      const result = await createView(size)
      if (isErr(result)) {
        fail(result)
        return
      }
      view = result
      if (disposed || state.peek().type === 'error') {
        stopViewer()
        return
      }
      result.el.style.width = '100%'
      result.el.style.height = '100%'
      result.el.style.overflow = 'hidden'
      const video = result.el.querySelector('video')
      if (video) {
        video.style.width = '100%'
        video.style.height = '100%'
        video.style.objectFit = 'contain'
      }
      result.addEventListener('ready', onReady, { once: true })
      element.appendChild(result.el)
      result.start()
    } catch (cause) {
      fail(
        isErr(cause)
          ? cause
          : new Error('Unable to connect to the engine', { cause })
      )
    }
  }

  return {
    element,
    state,
    snapshot,
    sendSceneCommand: (command: WebSocketRequest) =>
      enqueue(async () => {
        const connected = await ready.promise
        if (connected instanceof Error) return Promise.reject(connected)
        if (unavailable() || !connected.rtc)
          return Promise.reject(new Error('The engine session is unavailable'))
        return connected.rtc.send(JSON.stringify(command))
      }),
    evaluateExpression: (ast: Node<Program>) =>
      enqueue(async () => {
        if (unavailable() || !runtimePromise || !snapshot.peek())
          return Promise.reject(
            new Error('Execute the model before evaluating an argument')
          )
        return (await runtimePromise).evaluateExpression(ast)
      }),
    validate: (ast: Node<Program>, expected: KclModelSnapshot) =>
      enqueue(async () => {
        if (unavailable() || snapshot.peek() !== expected || !runtimePromise)
          return new Error('The model changed before review')
        return (await runtimePromise).validate(ast, expected.src ?? 'main.kcl')
      }),
    waitForAllEngineModelingCommands: () =>
      enqueue(async () => {
        await runtime?.waitForAllEngineModelingCommands()
      }),
    mount: (container: HTMLElement) => {
      container.appendChild(element)
      // Inactive tab panels mount with display:none. Wait for a usable layout
      // before requesting a stream; the engine cannot connect at a hidden tab's 0x0 size.
      const startWhenVisible = () => {
        if (started || disposed || element.parentElement !== container) return
        const width = container.clientWidth - (container.clientWidth % 4)
        const height = container.clientHeight - (container.clientHeight % 4)
        if (width < 4 || height < 4) return
        started = true
        observer.disconnect()
        layoutObservers.delete(observer)
        start({ width, height }).catch(reportRejection)
      }
      const observer = new ResizeObserver(startWhenVisible)
      layoutObservers.add(observer)
      if (!started && !disposed) {
        observer.observe(container)
        startWhenVisible()
      }
      // React can detach/remount a view; the executor still owns its connection.
      return () => {
        observer.disconnect()
        layoutObservers.delete(observer)
        if (element.parentElement === container) element.remove()
      }
    },
    execute: (
      contents: KclSources,
      src: string,
      signal: AbortSignal
    ): Promise<{ result: ExecState } | Error> => {
      snapshot.value = undefined
      const run = enqueue(async () => {
        const connected = await ready.promise
        if (isErr(connected)) return connected
        const connection = state.peek()
        if (connection.type === 'error') return connection.error
        if (signal.aborted || unavailable())
          return new Error('KCL execution was cancelled')
        const rtc = connected.rtc
        if (!rtc) return new Error('The engine session is unavailable')
        try {
          // Native execution cannot retract commands already sent to the engine.
          // Finish the current run before starting another, and skip interrupted queued inputs.
          const submit = async () => {
            if (!runtimePromise)
              return new Error('The KCL runtime is unavailable')
            const model = await runtimePromise
            const execution = await model.execute(contents, src)
            // WASM applies its own colors, edges and grid defaults on each run.
            const settingsError = await applySettings(connected, true)
            if (isErr(settingsError)) return settingsError
            const output = { result: execution }
            if (signal.aborted || unavailable())
              return new Error('KCL execution was cancelled')
            if (!framed) {
              await rtc.send(
                JSON.stringify({
                  type: 'modeling_cmd_req',
                  cmd_id: crypto.randomUUID(),
                  cmd: { type: 'zoom_to_fit', object_ids: [], padding: 0.1 },
                })
              )
              framed = true
            }
            if (signal.aborted || unavailable())
              return new Error('KCL execution was cancelled')
            snapshot.value = {
              src,
              contents:
                typeof contents === 'string'
                  ? contents
                  : (contents.get(src) ?? ''),
              execState: execution,
            }
            return output
          }
          const executionTimeout = setTimeout(
            () =>
              fail(
                new Error(
                  'KCL execution timed out. Close this view and try again.'
                )
              ),
            60_000
          )
          try {
            return await Promise.race([submit(), closed.promise])
          } finally {
            clearTimeout(executionTimeout)
          }
        } catch (cause) {
          return isErr(cause)
            ? cause
            : new Error('KCL execution failed', { cause })
        }
      })
      return run
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      unsubscribeSettings()
      for (const observer of layoutObservers) observer.disconnect()
      layoutObservers.clear()
      clearTimeout(timeout)
      const error = new Error('The executor closed')
      ready.resolve(error)
      closed.resolve(error)
      state.value = { type: 'closed' }
      snapshot.value = undefined
      void queue
        .then(async () => (await runtimePromise)?.dispose())
        .catch(reportRejection)
      stopViewer()
      element.remove()
    },
  }
}
export type KclSession = ReturnType<typeof createKclSession>
