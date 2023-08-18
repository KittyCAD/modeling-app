import { lexer_js } from '../wasm-lib/pkg/wasm_lib'
import { initPromise } from './rust'

export interface Token {
  type:
    | 'number'
    | 'word'
    | 'operator'
    | 'string'
    | 'brace'
    | 'whitespace'
    | 'comma'
    | 'colon'
    | 'period'
    | 'linecomment'
    | 'blockcomment'
  value: string
  start: number
  end: number
}

export async function asyncLexer(str: string): Promise<Token[]> {
  await initPromise
  const tokens: Token[] = lexer_js(str)
  return tokens
}

export function lexer(str: string): Token[] {
  const tokens: Token[] = lexer_js(str)
  return tokens
}
