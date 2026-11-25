import type { KclValueView } from '@rust/kcl-lib/bindings/KclValueView'
import {
  defineExecutorCapability,
  type ExecutorRunContext,
  type ExecutorCapability,
} from '@src/lib/executors/registry/contract'
import { isErr } from '@src/lib/trap'

/** Evaluated sheets use physical millimeters, independently of viewport pixels. */
export interface DrawingSheet {
  readonly name: string
  readonly size: string
  readonly width: number
  readonly height: number
}

/** Read the public drawing::Sheet record from typed KCL memory. Other declarations are ignored. */
function readSheet(
  name: string,
  value: KclValueView
): DrawingSheet | undefined {
  if (value.type !== 'Sheet') return
  const factor = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, yd: 914.4 }
  const millimeters = (length: typeof value.value.width) => {
    const ty = length.ty
    return ty.type === 'Known' && ty.value.type === 'Length'
      ? length.n * factor[ty.value.value]
      : undefined
  }
  const width = millimeters(value.value.width)
  const height = millimeters(value.value.height)
  if (width === undefined || height === undefined) return
  return { name, size: value.value.name, width, height }
}

/** Evaluate declarations so computed sizes and imported constructors behave like ordinary KCL. */
export function createDrawingsExecutorCapability(
  evaluate: (
    contents: string,
    context: ExecutorRunContext
  ) => Promise<Record<string, KclValueView> | Error>,
  revision?: ExecutorCapability['revision']
) {
  return defineExecutorCapability({
    id: 'drawings.execute',
    revision,
    matches: '.kcl',
    execute: async (contents: string, context: ExecutorRunContext) => {
      const variables = await evaluate(contents, context)
      if (isErr(variables)) return variables
      const sheets: DrawingSheet[] = []
      for (const [name, value] of Object.entries(variables)) {
        const sheet = readSheet(name, value)
        if (sheet) sheets.push(sheet)
      }
      return { sheets }
    },
  })
}
export type DrawingsExecutorCapability = ReturnType<
  typeof createDrawingsExecutorCapability
>
