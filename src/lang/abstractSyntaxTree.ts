import { Program } from './abstractSyntaxTreeTypes'
import { parse_js } from '../wasm-lib/pkg/wasm_lib'
import { initPromise } from './rust'

export const parser_wasm = (code: string): Program => {
  const program: Program = parse_js(code)
  return program
}

export async function asyncParser(code: string): Promise<Program> {
  await initPromise
  const program: Program = parse_js(code)
  return program
}

export function rangeOfToken(token: Token | undefined): [number, number][] {
  return token === undefined ? [] : [[token.start, token.end]]
}
