import init, {
  parse_wasm,
  recast_wasm,
  execute_wasm,
  lexer_wasm,
  modify_ast_for_sketch_wasm,
} from '../wasm-lib/pkg/wasm_lib'
import { KCLError } from './errors'
import { KclError as RustKclError } from '../wasm-lib/kcl/bindings/KclError'
import {
  EngineCommandManager,
  ArtifactMap,
  SourceRangeMap,
} from './std/engineConnection'
import { ProgramReturn } from '../wasm-lib/kcl/bindings/ProgramReturn'
import { MemoryItem } from '../wasm-lib/kcl/bindings/MemoryItem'
import type { Program } from '../wasm-lib/kcl/bindings/Program'
import type { Token } from '../wasm-lib/kcl/bindings/Token'

export type { Program } from '../wasm-lib/kcl/bindings/Program'
export type { Value } from '../wasm-lib/kcl/bindings/Value'
export type { ObjectExpression } from '../wasm-lib/kcl/bindings/ObjectExpression'
export type { MemberExpression } from '../wasm-lib/kcl/bindings/MemberExpression'
export type { PipeExpression } from '../wasm-lib/kcl/bindings/PipeExpression'
export type { VariableDeclaration } from '../wasm-lib/kcl/bindings/VariableDeclaration'
export type { PipeSubstitution } from '../wasm-lib/kcl/bindings/PipeSubstitution'
export type { Identifier } from '../wasm-lib/kcl/bindings/Identifier'
export type { UnaryExpression } from '../wasm-lib/kcl/bindings/UnaryExpression'
export type { BinaryExpression } from '../wasm-lib/kcl/bindings/BinaryExpression'
export type { ReturnStatement } from '../wasm-lib/kcl/bindings/ReturnStatement'
export type { ExpressionStatement } from '../wasm-lib/kcl/bindings/ExpressionStatement'
export type { CallExpression } from '../wasm-lib/kcl/bindings/CallExpression'
export type { VariableDeclarator } from '../wasm-lib/kcl/bindings/VariableDeclarator'
export type { BinaryPart } from '../wasm-lib/kcl/bindings/BinaryPart'
export type { Literal } from '../wasm-lib/kcl/bindings/Literal'
export type { ArrayExpression } from '../wasm-lib/kcl/bindings/ArrayExpression'

export type SyntaxType =
  | 'Program'
  | 'ExpressionStatement'
  | 'BinaryExpression'
  | 'CallExpression'
  | 'Identifier'
  | 'ReturnStatement'
  | 'VariableDeclaration'
  | 'VariableDeclarator'
  | 'MemberExpression'
  | 'ArrayExpression'
  | 'ObjectExpression'
  | 'ObjectProperty'
  | 'FunctionExpression'
  | 'PipeExpression'
  | 'PipeSubstitution'
  | 'Literal'
  | 'NonCodeNode'
  | 'UnaryExpression'

export type { SourceRange } from '../wasm-lib/kcl/bindings/SourceRange'
export type { Position } from '../wasm-lib/kcl/bindings/Position'
export type { Rotation } from '../wasm-lib/kcl/bindings/Rotation'
export type { Path } from '../wasm-lib/kcl/bindings/Path'
export type { SketchGroup } from '../wasm-lib/kcl/bindings/SketchGroup'
export type { MemoryItem } from '../wasm-lib/kcl/bindings/MemoryItem'
export type { ExtrudeSurface } from '../wasm-lib/kcl/bindings/ExtrudeSurface'

// Initialise the wasm module.
const initialise = async () => {
  const baseUrl =
    typeof window === 'undefined'
      ? 'http://127.0.0.1:3000'
      : window.location.origin.includes('tauri://localhost')
      ? 'tauri://localhost'
      : window.location.origin.includes('localhost')
      ? 'http://localhost:3000'
      : window.location.origin && window.location.origin !== 'null'
      ? window.location.origin
      : 'http://localhost:3000'
  const fullUrl = baseUrl + '/wasm_lib_bg.wasm'
  const input = await fetch(fullUrl)
  const buffer = await input.arrayBuffer()
  return init(buffer)
}

export const initPromise = initialise()

export const rangeTypeFix = (ranges: number[][]): [number, number][] =>
  ranges.map(([start, end]) => [start, end])

export const parse = (code: string): Program => {
  try {
    const program: Program = parse_wasm(code)
    return program
  } catch (e: any) {
    const parsed: RustKclError = JSON.parse(e.toString())
    const kclError = new KCLError(
      parsed.kind,
      parsed.msg,
      rangeTypeFix(parsed.sourceRanges)
    )

    console.log(kclError)
    throw kclError
  }
}

export type PathToNode = [string | number, string][]

interface Memory {
  [key: string]: MemoryItem
}

export interface ProgramMemory {
  root: Memory
  return: ProgramReturn | null
}

export const executor = async (
  node: Program,
  programMemory: ProgramMemory = { root: {}, return: null },
  engineCommandManager: EngineCommandManager,
  // work around while the gemotry is still be stored on the frontend
  // will be removed when the stream UI is added.
  tempMapCallback: (a: {
    artifactMap: ArtifactMap
    sourceRangeMap: SourceRangeMap
  }) => void = () => {}
): Promise<ProgramMemory> => {
  engineCommandManager.startNewSession()
  const _programMemory = await _executor(
    node,
    programMemory,
    engineCommandManager
  )
  const { artifactMap, sourceRangeMap } =
    await engineCommandManager.waitForAllCommands(node, _programMemory)
  tempMapCallback({ artifactMap, sourceRangeMap })

  engineCommandManager.endSession()
  return _programMemory
}

export const _executor = async (
  node: Program,
  programMemory: ProgramMemory = { root: {}, return: null },
  engineCommandManager: EngineCommandManager
): Promise<ProgramMemory> => {
  try {
    const memory: ProgramMemory = await execute_wasm(
      JSON.stringify(node),
      JSON.stringify(programMemory),
      engineCommandManager
    )
    return memory
  } catch (e: any) {
    const parsed: RustKclError = JSON.parse(e.toString())
    const kclError = new KCLError(
      parsed.kind,
      parsed.msg,
      rangeTypeFix(parsed.sourceRanges)
    )

    console.log(kclError)
    throw kclError
  }
}

export const recast = (ast: Program): string => {
  try {
    const s: string = recast_wasm(JSON.stringify(ast))
    return s
  } catch (e) {
    // TODO: do something real with the error.
    console.log('recast error', e)
    throw e
  }
}

export function lexer(str: string): Token[] {
  try {
    const tokens: Token[] = lexer_wasm(str)
    return tokens
  } catch (e) {
    // TODO: do something real with the error.
    console.log('lexer error', e)
    throw e
  }
}

export const modifyAstForSketch = async (
  engineCommandManager: EngineCommandManager,
  ast: Program,
  variableName: string,
  engineId: string
): Promise<Program> => {
  try {
    const updatedAst: Program = await modify_ast_for_sketch_wasm(
      engineCommandManager,
      JSON.stringify(ast),
      variableName,
      engineId
    )

    return updatedAst
  } catch (e: any) {
    const parsed: RustKclError = JSON.parse(e.toString())
    const kclError = new KCLError(
      parsed.kind,
      parsed.msg,
      rangeTypeFix(parsed.sourceRanges)
    )

    console.log(kclError)
    throw kclError
  }
}
