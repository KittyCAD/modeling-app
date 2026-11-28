import type { NativeContextHost } from '@src/lib/rustContext/nativeHost'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@src/lang/wasm'
import { getSettingsAnnotation } from '@src/lang/queryAst'
import type { KclSettingsAnnotation } from '@src/lib/settings/settingsTypes'
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

type NativeEngine = Pick<
  ConnectionManager,
  | 'engineSessionId'
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
  let entrypoint: string | undefined
  let executedConfiguration: string | undefined
  let disposed = false
  let disposing: Promise<void> | undefined
  let nativeFreed = false
  const pendingResponses = new Set<Promise<unknown>>()
  let queue: Promise<unknown> = Promise.resolve()
  const sources = signal<KclSourceSnapshot | undefined>(undefined)
  const state = signal<ExecState>(emptyExecState())
  const executing = signal(false)
  const program = signal<Node<Program> | null>(null)
  const fileSettings = signal<KclSettingsAnnotation>({})
  const executionRevision = signal(0)
  const executionElapsedMs = signal<number | null>(null)
  let elapsedTimer: ReturnType<typeof setInterval> | undefined
  const failed = signal(false)
  const events = new EventTarget()
  const fileSystem = {
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
  }
  const native = new wasm.Context(engine, fileSystem)
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
  let sketch:
    | { configuration: string; invalidate: () => Promise<void> }
    | undefined
  const matchesSketch = (
    snapshot: KclSourceSnapshot,
    configuration: object
  ) => {
    if (
      !sketch ||
      sketch.configuration !== JSON.stringify(configuration) ||
      snapshot.files.size !== files.size
    )
      return false
    for (const [path, bytes] of snapshot.files) {
      const expected = files.get(fsZds.join(path))
      if (
        !expected ||
        expected.length !== bytes.length ||
        bytes.some((byte, index) => expected[index] !== byte)
      )
        return false
    }
    return true
  }
  const executionProgram = (
    snapshot: KclSourceSnapshot,
    configuration: string
  ) =>
    Effect.gen(function* () {
      sources.value = undefined
      const path = fsZds.join(snapshot.src)
      entrypoint = path
      files = new Map(
        [...snapshot.files].map(([path, bytes]) => [
          fsZds.join(path),
          bytes.slice(),
        ])
      )
      yield* fromPromise(() =>
        native.open_project(
          0,
          JSON.stringify([
            {
              id: 0,
              path,
              text: new TextDecoder().decode(files.get(path)),
            },
          ]),
          0
        )
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
      const annotation = getSettingsAnnotation(ast.program, wasm)
      if (disposed) return yield* Effect.fail(new Error('The KCL scene closed'))
      const delta: SceneGraphDelta = yield* fromPromise(() =>
        native.execute(JSON.stringify(ast.program), snapshot.src, configuration)
      )
      yield* fromPromise(() => engine.waitForAllModelingCommands())
      const result = execStateFromRust(delta.exec_outcome)
      if (disposed) return yield* Effect.fail(new Error('The KCL scene closed'))
      executedConfiguration = configuration
      batch(() => {
        state.value = result
        program.value = ast.program
        fileSettings.value = isErr(annotation) ? {} : annotation
        failed.value = false
      })
      sources.value = {
        src: snapshot.src,
        files: new Map(
          [...files].map(([path, bytes]) => [path, bytes.slice()])
        ),
      }
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
            executionRevision.value++
            executing.value = true
            const started = performance.now()
            executionElapsedMs.value = 0
            elapsedTimer = setInterval(() => {
              executionElapsedMs.value = performance.now() - started
            }, 100)
            return { stopTracking, started }
          }),
          () => executionProgram(snapshot, capturedSettings),
          ({ stopTracking, started }, exit) =>
            Effect.sync(() => {
              const successful = Exit.isSuccess(exit)
              clearInterval(elapsedTimer)
              executionElapsedMs.value = performance.now() - started
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
  // Let the legacy RustContext wrapper share this runtime's native state and
  // operation queue. This runtime retains ownership of native.free(); see
  // NativeContextHost for the migration rationale and replacement path.
  const nativeContextHost: NativeContextHost = {
    create: async () => {
      if (disposed) return Promise.reject(new Error('The KCL scene closed'))
      return native
    },
    run: enqueue,
    deliverResponse: <T>(work: () => Promise<T>) => {
      if (nativeFreed)
        return Promise.reject<T>(new Error('The KCL scene closed'))
      const response = Promise.resolve().then(work)
      pendingResponses.add(response)
      const settled = () => pendingResponses.delete(response)
      response.then(settled, settled)
      return response
    },
  }
  return {
    nativeContextHost,
    /** The machine owns native edits until external source/settings changes require a full executor run. */
    borrowModel: (invalidate: () => Promise<void>) => {
      if (disposed || disposing || sketch)
        return new Error('The native model already has an editing owner')
      const owner = {
        configuration: executedConfiguration ?? settings(),
        invalidate,
      }
      sketch = owner
      const current = () => sketch === owner && !disposed
      return {
        source: (text: string) => {
          if (!current() || !entrypoint) return
          files = new Map(files).set(entrypoint, new TextEncoder().encode(text))
          const parsed = parse(text, wasm)
          if (!isErr(parsed) && resultIsOk(parsed)) {
            program.value = parsed.program
            const annotation = getSettingsAnnotation(parsed.program, wasm)
            if (!isErr(annotation)) fileSettings.value = annotation
          }
          sources.value = { src: entrypoint, files: new Map(files) }
        },
        publish: (output: ExecState) => {
          if (current()) state.value = output
        },
        completed: (detail: SceneExecutionDoneDetail) => {
          if (!current()) return
          executionRevision.value++
          failed.value = !detail.successful
          events.dispatchEvent(
            new CustomEvent(SceneExecutionEvents.ExecutionDone, { detail })
          )
        },
        release: () => {
          if (sketch === owner) sketch = undefined
        },
      }
    },
    state,
    ast: program,
    fileSettings,
    sources,
    executionRevision,
    executionElapsedMs,
    executing,
    failed,
    events,
    execute: async (
      snapshot: KclSourceSnapshot,
      configuration: object = getSettings()
    ) => {
      if (disposed || disposing)
        return Promise.reject(new Error('The KCL scene closed'))
      if (sketch) {
        if (
          matchesSketch(snapshot, configuration) &&
          fsZds.join(snapshot.src) === entrypoint
        )
          return state.peek()
        await sketch.invalidate()
      }
      return execute(snapshot, configuration)
    },
    exportModel: (
      format: Parameters<LocalRendererHost['exportModel']>[0]
    ): ReturnType<LocalRendererHost['exportModel']> =>
      enqueue(async () => native.export(JSON.stringify(format), settings())),
    endSketch: async () => {
      await sketch?.invalidate()
    },
    dispose() {
      if (disposing) return disposing
      disposing = (async () => {
        try {
          await sketch?.invalidate()
        } finally {
          disposed = true
          sources.value = undefined
          clearInterval(elapsedTimer)
          await queue
          // A reply must remain deliverable while queued native work is draining.
          // Once both paths settle, reject new replies before releasing memory.
          while (pendingResponses.size)
            await Promise.allSettled([...pendingResponses])
          nativeFreed = true
          native.free()
        }
      })()
      return disposing
    },
  }
}
export type KclRuntime = Awaited<ReturnType<typeof createKclRuntime>>
