import { Program } from './abstractSyntaxTreeTypes'
import { recast_js } from '../wasm-lib/pkg/wasm_lib'

export const recast = (ast: Program): string => recast_js(JSON.stringify(ast))
