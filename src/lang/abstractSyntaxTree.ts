import { Program } from './abstractSyntaxTreeTypes'
import { parse_js } from '../wasm-lib/pkg/wasm_lib'
import { initPromise } from './rust'
import { Token } from './tokeniser'
import { KCLError } from './errors'

export const parser_wasm = (code: string): Program => {
  try {
    const json = parse_js(code)
    const program: Program = JSON.parse(json)
    return program
  } catch (e: any) {
    const parsed: {
      kind: string
      msg: string
      sourceRanges: [number, number][]
    } = JSON.parse(e.toString())
    const kclError: KCLError = new KCLError(
      parsed.kind,
      parsed.msg,
      parsed.sourceRanges
    )

    console.log(kclError)
    throw kclError
  }
}

export async function asyncParser(code: string): Promise<Program> {
  await initPromise
  try {
    const json = parse_js(code)
    const program: Program = JSON.parse(json)
    return program
  } catch (e: any) {
    const parsed: {
      kind: string
      msg: string
      sourceRanges: [number, number][]
    } = JSON.parse(e.toString())
    const kclError: KCLError = new KCLError(
      parsed.kind,
      parsed.msg,
      parsed.sourceRanges
    )

    console.log(kclError)
    throw kclError
  }
}

export function rangeOfToken(token: Token | undefined): [number, number][] {
  return token === undefined ? [] : [[token.start, token.end]]
}
