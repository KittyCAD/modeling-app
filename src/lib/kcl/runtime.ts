import { encode } from '@msgpack/msgpack'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  errFromErrWithOutputs,
  execStateFromRust,
  parse,
  resultIsOk,
  type Program,
} from '@src/lang/wasm'
import fsZds from '@src/lib/fs-zds'
import type { KclSources } from '@src/lib/kcl/session'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

/** One native context retains the displayed model's memory for command expressions and mock review. */
export async function createViewerKclRuntime(
  wasmInstancePromise: Promise<ModuleType>,
  send: (command: string) => Promise<unknown>,
  getSettings: () => object
) {
  const wasm = await wasmInstancePromise
  let files = new Map<string, string>()
  let disposed = false
  const pending = new Set<Promise<unknown>>()
  let fireError: unknown
  const operations = new Set<Promise<unknown>>()
  const withNative = async <T>(work: () => Promise<T>): Promise<T> => {
    if (disposed) return Promise.reject(new Error('The engine session closed'))
    const operation = work()
    operations.add(operation)
    try {
      return await operation
    } finally {
      operations.delete(operation)
    }
  }
  const executionError = (cause: unknown) =>
    cause instanceof Error ? cause : errFromErrWithOutputs(cause)
  const sendCommand = async (_id: string, _range: string, command: string) => {
    if (disposed) return Promise.reject(new Error('The engine session closed'))
    const response = send(command)
    pending.add(response)
    try {
      return encode(await response)
    } finally {
      pending.delete(response)
    }
  }
  const filesystem = {
    async readFile(path: string) {
      const source = files.get(fsZds.join(path))
      if (source === undefined)
        return Promise.reject(new Error(`KCL module not found: ${path}`))
      return new TextEncoder().encode(source)
    },
    async exists(path: string) {
      return files.has(fsZds.join(path))
    },
    async getAllFiles() {
      return JSON.stringify([...files.keys()])
    },
  }
  const native = new wasm.Context(
    {
      sendModelingCommandFromWasm: sendCommand,
      fireModelingCommandFromWasm: (
        ...args: Parameters<typeof sendCommand>
      ) => {
        void sendCommand(...args).catch((cause: unknown) => {
          fireError = cause
        })
      },
      async startNewSession() {},
    },
    filesystem,
    undefined,
    true
  )
  // Successful executeMock replaces its context's cached variables, even with usePrevMemory=false.
  // Review must use separate memory so later input calculations still see the displayed model.
  const analysis = new wasm.Context(
    {
      async sendModelingCommandFromWasm() {
        return Promise.reject(
          new Error('Mock review cannot send engine commands')
        )
      },
      fireModelingCommandFromWasm() {
        // Rust's synchronous callback boundary catches thrown errors; it cannot await a rejected promise.
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new Error('Mock review cannot send engine commands')
      },
      async startNewSession() {},
    },
    filesystem,
    undefined,
    true
  )
  const settings = () => JSON.stringify(getSettings())
  return {
    wasmInstancePromise,
    async execute(sources: KclSources, src: string) {
      fireError = undefined
      files =
        typeof sources === 'string'
          ? new Map([[fsZds.join(src), sources]])
          : new Map(
              [...sources].map(([path, contents]) => [
                fsZds.join(path),
                contents,
              ])
            )
      const contents = files.get(fsZds.join(src))
      if (contents === undefined)
        return Promise.reject(
          new Error('The entrypoint is missing from the KCL snapshot')
        )
      const ast = parse(contents, wasm)
      if (ast instanceof Error) return Promise.reject(ast)
      if (!resultIsOk(ast))
        return Promise.reject(new Error('Fix the KCL syntax before executing'))
      try {
        const result: SceneGraphDelta = await withNative(() =>
          native.execute(JSON.stringify(ast.program), src, settings())
        )
        await Promise.all(pending)
        if (fireError) return Promise.reject(fireError)
        return execStateFromRust(result.exec_outcome)
      } catch (cause) {
        return Promise.reject(executionError(cause))
      }
    },
    async evaluateExpression(ast: Node<Program>) {
      try {
        return execStateFromRust(
          await withNative(() =>
            native.evaluateExpression(JSON.stringify(ast), settings())
          )
        )
      } catch (cause) {
        return Promise.reject(executionError(cause))
      }
    },
    async validate(ast: Node<Program>, src: string) {
      try {
        await withNative(() =>
          analysis.executeMock(JSON.stringify(ast), src, settings(), false)
        )
      } catch (cause) {
        return executionError(cause)
      }
    },
    async waitForAllEngineModelingCommands() {
      await Promise.all(pending)
    },
    async dispose() {
      if (disposed) return
      disposed = true
      // A WASM method borrows its context across await; freeing it sooner can trap.
      await Promise.allSettled(operations)
      native.free()
      analysis.free()
    },
  }
}
export type ViewerKclRuntime = Awaited<
  ReturnType<typeof createViewerKclRuntime>
>
export type CreateViewerKclRuntime = (
  send: (command: string) => Promise<unknown>
) => Promise<
  Pick<
    ViewerKclRuntime,
    | 'execute'
    | 'evaluateExpression'
    | 'validate'
    | 'waitForAllEngineModelingCommands'
    | 'dispose'
  >
>
