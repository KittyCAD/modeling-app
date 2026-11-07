import type { KclValueView } from '@rust/kcl-lib/bindings/KclValueView'
import {
  defineExecutorCapability,
  type ExecutorRunContext,
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
  if (value.type !== 'Object') return
  const { size, width, height } = value.value
  if (
    size?.type !== 'Enum' ||
    size.enum_name !== 'PaperSize' ||
    width?.type !== 'Number' ||
    height?.type !== 'Number' ||
    width.ty.type !== 'Known' ||
    width.ty.value.type !== 'Length' ||
    width.ty.value.value !== 'mm' ||
    height.ty.type !== 'Known' ||
    height.ty.value.type !== 'Length' ||
    height.ty.value.value !== 'mm'
  )
    return
  return { name, size: size.variant, width: width.value, height: height.value }
}

/** Evaluate declarations so computed sizes and imported constructors behave like ordinary KCL. */
export function createDrawingsExecutorCapability(
  evaluate: (
    contents: string,
    context: ExecutorRunContext
  ) => Promise<Record<string, KclValueView> | Error>
) {
  return defineExecutorCapability({
    id: 'drawings.execute',
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
