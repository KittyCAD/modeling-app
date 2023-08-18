import { Program } from './abstractSyntaxTreeTypes'
import { recast_js } from '../wasm-lib/pkg/wasm_lib'

export const recast = (ast: Program): string => {
  try {
    const s: string = recast_js(JSON.stringify(ast))
    return s
  } catch (e) {
    // TODO: do something real with the error.
    console.log('recast', e)
    throw e
  }
}
