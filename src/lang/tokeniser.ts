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

export async function lexer(str: string): Promise<Token[]> {
  await initPromise
  const tokens = JSON.parse(lexer_js(str)).map(
    ({
      token_type,
      start,
      end,
      value,
    }: {
      token_type: string
      start: number
      end: number
      value: string
    }) => ({
      type: token_type.toLowerCase(),
      value,
      start,
      end,
    })
  ) as Token[]
  return tokens
}

export function syncLexer(str: string): Token[] {
  // await initPromise
  const tokens = JSON.parse(lexer_js(str)).map(
    ({
      token_type,
      start,
      end,
      value,
    }: {
      token_type: string
      start: number
      end: number
      value: string
    }) => ({
      type: token_type.toLowerCase(),
      value,
      start,
      end,
    })
  ) as Token[]
  return tokens
}
