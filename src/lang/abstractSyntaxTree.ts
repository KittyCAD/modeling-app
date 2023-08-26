import { Program } from './abstractSyntaxTreeTypes'
import { parse_js } from '../wasm-lib/pkg/wasm_lib'
import { initPromise } from './rust'
import { Token } from './tokeniser'
import { KCLError } from './errors'
import { KclError as RustKclError } from '../wasm-lib/bindings/KclError'

export const rangeTypeFix = (ranges: number[][]): [number, number][] =>
  ranges.map(([start, end]) => [start, end])

export const parser_wasm = (code: string): Program => {
  try {
    const program: Program = parse_js(code)
    return program
  } catch (e: any) {
    const parsed: RustKclError = JSON.parse(e.toString())
    const kclError = new KCLError(
      parsed.kind,
      parsed.kind === 'invalid_expression' ? parsed.kind : parsed.msg,
      parsed.kind === 'invalid_expression'
        ? [[parsed.start, parsed.end]]
        : rangeTypeFix(parsed.sourceRanges)
    )

    console.log(kclError)
    throw kclError
  }
}

export async function asyncParser(code: string): Promise<Program> {
  await initPromise
  try {
    const program: Program = parse_js(code)
    return program
  } catch (e: any) {
    const parsed: RustKclError = JSON.parse(e.toString())
    const kclError = new KCLError(
      parsed.kind,
      parsed.kind === 'invalid_expression' ? parsed.kind : parsed.msg,
      parsed.kind === 'invalid_expression'
        ? [[parsed.start, parsed.end]]
        : rangeTypeFix(parsed.sourceRanges)
    )

    console.log(kclError)
    throw kclError
  }
}

export function rangeOfToken(token: Token | undefined): [number, number][] {
  return token === undefined ? [] : [[token.start, token.end]]
}
