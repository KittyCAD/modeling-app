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
import type { KclSourceSnapshot } from '@src/lib/kcl/sources'
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

/** Each scene owns native model memory and serializes exports with execution to avoid overlapping WASM borrows. */
export async function createKclRuntime(
  wasmPromise: Promise<ModuleType>,
  engine: NativeEngine,
  getSettings: () => object,
  getRebuildRevision: () => string = () => ''
) {
  const wasm = await wasmPromise
  let files: ReadonlyMap<string, Uint8Array> = new Map()
  let disposed = false
  let queue: Promise<unknown> = Promise.resolve()
  const state = signal<ExecState>(emptyExecState())
  const executing = signal(false)
  const failed = signal(false)
  const events = new EventTarget()
  const native = new wasm.Context(engine, {
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
  let rebuiltRevision = getRebuildRevision()
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(() =>
      disposed ? Promise.reject<T>(new Error('The KCL scene closed')) : work()
    )
    queue = result.catch(() => undefined)
    return result
  }
  return {
    state,
    executing,
    failed,
    events,
    execute: (snapshot: KclSourceSnapshot) =>
      enqueue(async () => {
        const stopTracking = engine.trackExecution()
        executing.value = true
        files = new Map(
          [...snapshot.files].map(([path, bytes]) => [
            fsZds.join(path),
            bytes.slice(),
          ])
        )
        let successful = false
        try {
          const source = files.get(fsZds.join(snapshot.src))
          if (!source)
            return Promise.reject(
              new Error('The KCL entrypoint is missing from its snapshot')
            )
          const ast = parse(new TextDecoder().decode(source), wasm)
          if (isErr(ast)) return Promise.reject(ast)
          if (!resultIsOk(ast))
            return Promise.reject(new Error('Fix KCL syntax before executing'))
          const configuration = settings()
          const rebuildRevision = getRebuildRevision()
          if (rebuiltRevision !== rebuildRevision) {
            await native.bustCacheAndResetScene(configuration, snapshot.src)
            rebuiltRevision = rebuildRevision
          }
          if (disposed) return Promise.reject(new Error('The KCL scene closed'))
          const delta: SceneGraphDelta = await native.execute(
            JSON.stringify(ast.program),
            snapshot.src,
            configuration
          )
          await engine.waitForAllModelingCommands()
          const result = execStateFromRust(delta.exec_outcome)
          if (disposed) return Promise.reject(new Error('The KCL scene closed'))
          batch(() => {
            state.value = result
            failed.value = false
          })
          successful = true
          return result
        } catch (cause) {
          if (!disposed) failed.value = true
          if (isErr(cause)) return Promise.reject(cause)
          const error = errFromErrWithOutputs(cause)
          if (!disposed)
            state.value = {
              ...state.peek(),
              artifactGraph: error.artifactGraph,
              defaultPlanes: error.defaultPlanes,
              engineSceneGeneration: error.engineSceneGeneration,
            }
          return Promise.reject(error)
        } finally {
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
        }
      }),
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
