import type { ExecOutcome } from '@rust/kcl-lib/bindings/ExecOutcome'
import type { ProjectSourceSnapshot } from '@src/lib/projectSession/next/contract'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { parse, resultIsOk } from '@src/lang/wasm'
import fsZds from '@src/lib/fs-zds'
import { isErr } from '@src/lib/trap'
import { isRecord } from '@src/lib/utils'

/** Evaluate a captured document without opening an engine connection. Each request owns its native memory. */
export async function evaluateDrawings(
  snapshot: ProjectSourceSnapshot,
  wasm: ModuleType,
  signal: AbortSignal
) {
  const source = snapshot.files.get(snapshot.src)
  if (!source) return new Error('The drawing entrypoint is missing')
  if (signal.aborted) return new Error('Drawing execution was cancelled')
  const contents = new TextDecoder().decode(source)
  const parsed = parse(contents, wasm)
  if (isErr(parsed)) return parsed
  if (!resultIsOk(parsed))
    return new Error(
      parsed.errors.map(({ message }) => message).join('\n') ||
        'Unsupported KCL version for drawings'
    )
  const native = new wasm.Context(
    {},
    {
      readFile: async (path: string) => {
        const bytes = snapshot.files.get(fsZds.join(path))
        if (!bytes)
          return Promise.reject(new Error(`KCL file not found: ${path}`))
        return bytes.slice()
      },
      exists: async (path: string) => snapshot.files.has(fsZds.join(path)),
      getAllFiles: async () => JSON.stringify([...snapshot.files.keys()]),
    }
  )
  try {
    await native.open_project(
      0,
      JSON.stringify([{ id: 0, path: snapshot.src, text: contents }]),
      0
    )
    const result: ExecOutcome = await native.executeMock(
      JSON.stringify(parsed.program),
      snapshot.src,
      JSON.stringify({ settings: {} }),
      false
    )
    return signal.aborted
      ? new Error('Drawing execution was cancelled')
      : result.variables
  } catch (cause) {
    if (isErr(cause)) return cause
    if (
      isRecord(cause) &&
      isRecord(cause.error) &&
      isRecord(cause.error.details) &&
      typeof cause.error.details.msg === 'string'
    )
      return new Error(cause.error.details.msg)
    return new Error('Unable to evaluate drawing sheets', { cause })
  } finally {
    native.free()
  }
}
