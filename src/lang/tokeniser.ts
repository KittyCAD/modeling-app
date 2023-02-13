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

const massageRustData = ({
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

export async function asyncLexer(str: string): Promise<Token[]> {
  await initPromise
  const tokens = JSON.parse(lexer_js(str)).map(massageRustData) as Token[]
  return tokens
}

export function lexer(str: string): Token[] {
  return JSON.parse(lexer_js(str)).map(massageRustData) as Token[]
}
