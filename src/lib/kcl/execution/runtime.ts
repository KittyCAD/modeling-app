import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { batch, signal } from '@preact/signals-core'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import type { LocalRendererHost } from '@src/clientSideScene/localRenderer/host'
import {
  type ExecState,
  emptyExecState,
  errFromErrWithOutputs,
  execStateFromRust,
  parse,
  resultIsOk,
} from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import fsZds from '@src/lib/fs-zds'
import type { KclSourceSnapshot } from '@src/lib/kcl/execution/sources'
import {
  type SceneExecutionDoneDetail,
  SceneExecutionEvents,
} from '@src/lib/kcl/scene/execution'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { createNativeContext } from '@src/lib/wasmRuntime'

type NativeEngine = Pick<
  ConnectionManager,
  | 'engineSessionId'
  | 'geometryOnly'
  | 'sendModelingCommandFromWasm'
  | 'fireModelingCommandFromWasm'
  | 'startNewSession'
  | 'trackExecution'
  | 'waitForAllModelingCommands'
>

// WASM can reject with a serialized KCL error containing partial geometry.
// Keep that rejection intact for `executionProgram` to pass to `errFromErrWithOutputs`.
const fromPromise = <A>(work: () => Promise<A>) =>
  Effect.tryPromise({ try: work, catch: (cause) => cause })

/**
 * `openKclScene` creates one WASM `Context` per connection. Its filesystem reads
 * the current execution's captured bytes. The Promise queue orders all native
 * execution/exports, and `dispose` waits for that queue before calling `free`.
 */
export async function createKclRuntime(
  wasmPromise: Promise<ModuleType>,
  engine: NativeEngine,
  getSettings: () => object
) {
  const wasm = await wasmPromise
  let files: ReadonlyMap<string, Uint8Array> = new Map()
  let disposed = false
  let queue: Promise<unknown> = Promise.resolve()
  const state = signal<ExecState>(emptyExecState())
  const executing = signal(false)
  const failed = signal(false)
  const events = new EventTarget()
  const native = createNativeContext(wasm, engine, {
    async readFile(path: string) {
      const contents = files.get(fsZds.join(path))
      if (!contents)
        return Promise.reject(new Error(`KCL import not found: ${path}`))
      return contents.slice()
    },
    async exists(path: string) {
      return files.has(fsZds.join(path))
    },
    async getAllFiles() {
      return JSON.stringify([...files.keys()])
    },
  })
  const settings = () => JSON.stringify(getSettings())
  // A rejected operation must not poison later runs. Only the caller receives
  // its rejection; `queue` settles so disposal and subsequent operations can proceed.
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(() =>
      disposed ? Promise.reject<T>(new Error('The KCL scene closed')) : work()
    )
    queue = result.catch(() => undefined)
    return result
  }
  const executionProgram = (
    snapshot: KclSourceSnapshot,
    configuration: string
  ) =>
    Effect.gen(function* () {
      files = new Map(
        [...snapshot.files].map(([path, bytes]) => [
          fsZds.join(path),
          bytes.slice(),
        ])
      )
      const source = files.get(fsZds.join(snapshot.src))
      if (!source)
        return yield* Effect.fail(
          new Error('The KCL entrypoint is missing from its snapshot')
        )
      const ast = parse(new TextDecoder().decode(source), wasm)
      if (isErr(ast)) return yield* Effect.fail(ast)
      if (!resultIsOk(ast))
        return yield* Effect.fail(new Error('Fix KCL syntax before executing'))
      if (disposed) return yield* Effect.fail(new Error('The KCL scene closed'))
      const delta: SceneGraphDelta = yield* fromPromise(() =>
        native.execute(JSON.stringify(ast.program), snapshot.src, configuration)
      )
      yield* fromPromise(() => engine.waitForAllModelingCommands())
      const result = execStateFromRust(delta.exec_outcome)
      if (disposed) return yield* Effect.fail(new Error('The KCL scene closed'))
      batch(() => {
        state.value = result
        failed.value = false
      })
      return result
    }).pipe(
      // Native error output can contain newly created planes/artifacts. Preserve
      // that output for the renderer while rejecting the failed execution itself.
      Effect.catchAllCause((cause) =>
        Effect.suspend(() => {
          const failure = Cause.squash(cause)
          if (isErr(failure)) return Effect.fail(failure)
          const error = errFromErrWithOutputs(failure)
          if (!disposed)
            state.value = {
              ...state.peek(),
              artifactGraph: error.artifactGraph,
              defaultPlanes: error.defaultPlanes,
              engineSceneGeneration: error.engineSceneGeneration,
            }
          return Effect.fail(error)
        })
      )
    )
  const execute = (
    snapshot: KclSourceSnapshot,
    configuration: object = getSettings()
  ) => {
    const capturedSettings = JSON.stringify(configuration)
    return enqueue(async () => {
      // The WASM Promise cannot be interrupted safely. Keep this Effect
      // uninterruptible so `enqueue` waits for native execution to settle before
      // `dispose` frees the context. Successful runs also drain engine commands;
      // rejected runs go directly to error handling without that drain.
      const exit = await Effect.runPromiseExit(
        Effect.acquireUseRelease(
          Effect.sync(() => {
            const stopTracking = engine.trackExecution()
            executing.value = true
            return stopTracking
          }),
          () => executionProgram(snapshot, capturedSettings),
          (stopTracking, exit) =>
            Effect.sync(() => {
              const successful = Exit.isSuccess(exit)
              if (!disposed) failed.value = !successful
              executing.value = false
              stopTracking()
              if (!disposed)
                events.dispatchEvent(
                  new CustomEvent<SceneExecutionDoneDetail>(
                    SceneExecutionEvents.ExecutionDone,
                    {
                      detail: {
                        successful,
                        isInterrupted: false,
                        hasErrors: !successful,
                      },
                    }
                  )
                )
            })
        ).pipe(Effect.uninterruptible)
      )
      // `runPromiseExit` lets the Promise API reject with the original error,
      // rather than the `FiberFailure` wrapper produced by `Effect.runPromise`.
      return Exit.isSuccess(exit)
        ? exit.value
        : Promise.reject(Cause.squash(exit.cause))
    })
  }
  return {
    state,
    executing,
    failed,
    events,
    execute,

    exportModel: (
      format: Parameters<LocalRendererHost['exportModel']>[0]
    ): ReturnType<LocalRendererHost['exportModel']> =>
      enqueue(async () => native.export(JSON.stringify(format), settings())),
    async dispose() {
      if (disposed) return
      disposed = true
      await queue
      native.free()
    },
  }
}
export type KclRuntime = Awaited<ReturnType<typeof createKclRuntime>>
