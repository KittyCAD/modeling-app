import {
  Program,
  Value,
  BodyItem,
  VariableDeclarator,
  ObjectProperty,
} from './abstractSyntaxTreeTypes'

import { recast_js } from '../wasm-lib/pkg/wasm_lib'

export function recast(ast: Program): string {
  const json = JSON.stringify(ast, null, 2)
  return recast_js(json)
}
