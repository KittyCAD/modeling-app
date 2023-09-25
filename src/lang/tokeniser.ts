import { lexer_js } from '../wasm-lib/pkg/wasm_lib'
import { initPromise } from './rust'
import { Token } from '../wasm-lib/kcl/bindings/Token'

export type { Token } from '../wasm-lib/kcl/bindings/Token'

export async function asyncLexer(str: string): Promise<Token[]> {
  await initPromise
  try {
    const tokens: Token[] = lexer_js(str)
    return tokens
  } catch (e) {
    // TODO: do something real with the error.
    console.log('lexer error', e)
    throw e
  }
}

export function lexer(str: string): Token[] {
  try {
    const tokens: Token[] = lexer_js(str)
    return tokens
  } catch (e) {
    // TODO: do something real with the error.
    console.log('lexer error', e)
    throw e
  }
}
