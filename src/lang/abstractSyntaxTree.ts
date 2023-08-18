import { Program } from './abstractSyntaxTreeTypes'
import { parse_js } from '../wasm-lib/pkg/wasm_lib'
import { initPromise } from './rust'
import { Token } from './tokeniser'

export const parser_wasm = (code: string): Program => {
  try {
    const program: Program = parse_js(code)
    return program
  } catch (e) {
    // TODO: do something real with the error.
    console.log('abs tree', e)
    throw e
  }
}

export async function asyncParser(code: string): Promise<Program> {
  await initPromise
  try {
    const program: Program = parse_js(code)
    return program
  } catch (e) {
    // TODO: do something real with the error.
    console.log('abs tree', e)
    throw e
  }
}

export function rangeOfToken(token: Token | undefined): [number, number][] {
  return token === undefined ? [] : [[token.start, token.end]]
}
