import init, {
  parse_wasm,
  recast_wasm,
  execute_wasm,
  lexer_wasm,
  modify_ast_for_sketch_wasm,
  is_points_ccw,
  get_tangential_arc_to_info,
  program_memory_init,
  make_default_planes,
  coredump,
  toml_stringify,
  toml_parse,
} from '../wasm-lib/pkg/wasm_lib'
import { KCLError } from './errors'
import { KclError as RustKclError } from '../wasm-lib/kcl/bindings/KclError'
import { EngineCommandManager } from './std/engineConnection'
import { ProgramReturn } from '../wasm-lib/kcl/bindings/ProgramReturn'
import { MemoryItem } from '../wasm-lib/kcl/bindings/MemoryItem'
import type { Program } from '../wasm-lib/kcl/bindings/Program'
import type { Token } from '../wasm-lib/kcl/bindings/Token'
import { Coords2d } from './std/sketch'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import { AppInfo } from 'wasm-lib/kcl/bindings/AppInfo'
import { CoreDumpManager } from 'lib/coredump'
import openWindow from 'lib/openWindow'
import { DefaultPlanes } from 'wasm-lib/kcl/bindings/DefaultPlanes'
import { TEST } from 'env'

export type { Program } from '../wasm-lib/kcl/bindings/Program'
export type { Value } from '../wasm-lib/kcl/bindings/Value'
export type { ObjectExpression } from '../wasm-lib/kcl/bindings/ObjectExpression'
export type { MemberExpression } from '../wasm-lib/kcl/bindings/MemberExpression'
export type { PipeExpression } from '../wasm-lib/kcl/bindings/PipeExpression'
export type { VariableDeclaration } from '../wasm-lib/kcl/bindings/VariableDeclaration'
export type { Parameter } from '../wasm-lib/kcl/bindings/Parameter'
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
export type { ExtrudeGroup } from '../wasm-lib/kcl/bindings/ExtrudeGroup'
export type { MemoryItem } from '../wasm-lib/kcl/bindings/MemoryItem'
export type { ExtrudeSurface } from '../wasm-lib/kcl/bindings/ExtrudeSurface'

export const wasmUrl = () => {
  const baseUrl =
    typeof window === 'undefined'
      ? 'http://127.0.0.1:3000'
      : window.location.origin.includes('tauri://localhost')
      ? 'tauri://localhost' // custom protocol for macOS
      : window.location.origin.includes('tauri.localhost')
      ? 'http://tauri.localhost' // fallback for Windows
      : window.location.origin.includes('localhost')
      ? 'http://localhost:3000'
      : window.location.origin && window.location.origin !== 'null'
      ? window.location.origin
      : 'http://localhost:3000'
  const fullUrl = baseUrl + '/wasm_lib_bg.wasm'
  console.log(`Full URL for WASM: ${fullUrl}`)

  return fullUrl
}

// Initialise the wasm module.
const initialise = async () => {
  console.log('Initialising WASM')
  try {
    const fullUrl = wasmUrl()
    const input = await fetch(fullUrl)
    const buffer = await input.arrayBuffer()
    return await init(buffer)
  } catch (e) {
    console.log('Error initialising WASM', e)
    throw e
  }
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
  isMock: boolean = false
): Promise<ProgramMemory> => {
  engineCommandManager.startNewSession()
  const _programMemory = await _executor(
    node,
    programMemory,
    engineCommandManager,
    isMock
  )
  await engineCommandManager.waitForAllCommands()

  engineCommandManager.endSession()
  return _programMemory
}

export const _executor = async (
  node: Program,
  programMemory: ProgramMemory = { root: {}, return: null },
  engineCommandManager: EngineCommandManager,
  isMock: boolean
): Promise<ProgramMemory> => {
  try {
    let baseUnit = 'mm'
    if (!TEST) {
      const getSettingsState = import('components/SettingsAuthProvider').then(
        (module) => module.getSettingsState
      )
      baseUnit =
        (await getSettingsState)()?.modeling.defaultUnit.current || 'mm'
    }
    const memory: ProgramMemory = await execute_wasm(
      JSON.stringify(node),
      JSON.stringify(programMemory),
      baseUnit,
      engineCommandManager,
      fileSystemManager,
      isMock
    )
    return memory
  } catch (e: any) {
    console.log(e)
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

export const makeDefaultPlanes = async (
  engineCommandManager: EngineCommandManager
): Promise<DefaultPlanes> => {
  try {
    const planes: DefaultPlanes = await make_default_planes(
      engineCommandManager
    )
    return planes
  } catch (e) {
    // TODO: do something real with the error.
    console.log('make default planes error', e)
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
  currentPlane: string,
  engineId: string
): Promise<Program> => {
  try {
    const updatedAst: Program = await modify_ast_for_sketch_wasm(
      engineCommandManager,
      JSON.stringify(ast),
      variableName,
      JSON.stringify(currentPlane),
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

export function isPointsCCW(points: Coords2d[]): number {
  return is_points_ccw(new Float64Array(points.flat()))
}

export function getTangentialArcToInfo({
  arcStartPoint,
  arcEndPoint,
  tanPreviousPoint,
  obtuse = true,
}: {
  arcStartPoint: Coords2d
  arcEndPoint: Coords2d
  tanPreviousPoint: Coords2d
  obtuse?: boolean
}): {
  center: Coords2d
  arcMidPoint: Coords2d
  radius: number
  startAngle: number
  endAngle: number
  ccw: boolean
  arcLength: number
} {
  const result = get_tangential_arc_to_info(
    arcStartPoint[0],
    arcStartPoint[1],
    arcEndPoint[0],
    arcEndPoint[1],
    tanPreviousPoint[0],
    tanPreviousPoint[1],
    obtuse
  )
  return {
    center: [result.center_x, result.center_y],
    arcMidPoint: [result.arc_mid_point_x, result.arc_mid_point_y],
    radius: result.radius,
    startAngle: result.start_angle,
    endAngle: result.end_angle,
    ccw: result.ccw > 0,
    arcLength: result.arc_length,
  }
}

export function programMemoryInit(): ProgramMemory {
  try {
    const memory: ProgramMemory = program_memory_init()
    return memory
  } catch (e: any) {
    console.log(e)
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

export async function coreDump(
  coreDumpManager: CoreDumpManager,
  openGithubIssue: boolean = false
): Promise<AppInfo> {
  try {
    const dump: AppInfo = await coredump(coreDumpManager)
    if (openGithubIssue && dump.github_issue_url) {
      openWindow(dump.github_issue_url)
    }
    return dump
  } catch (e: any) {
    throw new Error(`Error getting core dump: ${e}`)
  }
}

export function tomlStringify(toml: any): string {
  try {
    const s: string = toml_stringify(JSON.stringify(toml))
    return s
  } catch (e: any) {
    throw new Error(`Error stringifying toml: ${e}`)
  }
}

export function tomlParse(toml: string): any {
  try {
    const parsed: any = toml_parse(toml)
    return parsed
  } catch (e: any) {
    throw new Error(`Error parsing toml: ${e}`)
  }
}
