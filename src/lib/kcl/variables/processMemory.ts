import type { ExtrudeSurfaceView } from '@rust/kcl-lib/bindings/ExtrudeSurfaceView'
import type { PathView } from '@rust/kcl-lib/bindings/PathView'
import {
  humanDisplayNumber,
  sketchFromKclValueOptional,
  type VariableMap,
} from '@src/lang/wasm'
import { Reason } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export const processMemory = (
  variables: VariableMap,
  wasmInstance: ModuleType
) => {
  const processedMemory: Record<
    string,
    string | number | boolean | object | null | undefined
  > = {}
  for (const [key, val] of Object.entries(variables)) {
    if (val === undefined) continue
    const sk = sketchFromKclValueOptional(val, key)
    if (val.type === 'Solid') {
      processedMemory[key] = val.value.value.map(
        ({ ...rest }: ExtrudeSurfaceView) => {
          return rest
        }
      )
    } else if (!(sk instanceof Reason)) {
      processedMemory[key] = sk.paths.map(
        ({ __geoMeta, ...rest }: PathView) => {
          return rest
        }
      )
    } else if (val.type === 'Function') {
      processedMemory[key] = '__function__'
    } else if (val.type === 'Number') {
      processedMemory[key] = humanDisplayNumber(val.value, val.ty, wasmInstance)
    } else if (val.type === 'SketchVar') {
      const sketchVar = val.value
      processedMemory[key] =
        `var ${humanDisplayNumber(sketchVar.initialValue, sketchVar.ty, wasmInstance)}`
    } else if (val.type === 'Enum') {
      // Enums are shown by nominal identity, the same way they are written.
      processedMemory[key] = `${val.enum_name}::${val.variant}`
    } else if ('value' in val) {
      processedMemory[key] = val.value
    } else {
      processedMemory[key] = undefined
    }
  }
  return processedMemory
}
