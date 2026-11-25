import {
  errFromErrWithOutputs,
  execStateFromRust,
  parse,
  resultIsOk,
} from '@src/lang/wasm'
import fsZds from '@src/lib/fs-zds'
import type { KclSourceSnapshot } from '@src/lib/kcl/execution/sources'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export async function evaluateVariables(
  snapshot: KclSourceSnapshot,
  wasmPromise: Promise<ModuleType>,
  settings: object,
  signal: AbortSignal
) {
  const wasm = await wasmPromise
  signal.throwIfAborted()
  const { src, files } = snapshot
  const source = files.get(fsZds.join(src))
  if (!source)
    return new Error('The KCL entrypoint is missing from its snapshot')
  const ast = parse(new TextDecoder().decode(source), wasm)
  if (ast instanceof Error) return ast
  if (!resultIsOk(ast)) return new Error('Fix KCL syntax to inspect variables')

  // Mock execution uses the captured imports but does not send engine commands.
  const context = new wasm.Context(
    {},
    {
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
  )
  try {
    const result = await context.executeMock(
      JSON.stringify(ast.program),
      src,
      JSON.stringify(settings),
      false
    )
    return { variables: execStateFromRust(result).variables, wasm }
  } catch (cause) {
    return cause instanceof Error ? cause : errFromErrWithOutputs(cause)
  } finally {
    context.free()
  }
}
