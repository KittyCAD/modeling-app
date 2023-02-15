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
  return JSON.parse(lexer_js(str)) as Token[]
}

export function lexer(str: string): Token[] {
  return JSON.parse(lexer_js(str)) as Token[]
}
