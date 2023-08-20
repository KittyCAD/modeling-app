import { lexer_js } from '../wasm-lib/pkg/wasm_lib'
import { initPromise } from './rust'
export type { Token } from '../wasm-lib/bindings/Token'
import { Token } from '../wasm-lib/bindings/Token'

export async function asyncLexer(str: string): Promise<Token[]> {
  await initPromise
  try {
    const tokens: Token[] = lexer_js(str)
    return tokens
  } catch (e) {
    // TODO: do something real with the error.
    console.log('lexer', e)
    throw e
  }
}

export function lexer(str: string): Token[] {
  try {
    const tokens: Token[] = lexer_js(str)
    return tokens
  } catch (e) {
    // TODO: do something real with the error.
    console.log('lexer', e)
    throw e
  }
}
