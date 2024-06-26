import init, {
  parse_wasm,
  recast_wasm,
  execute_wasm,
  kcl_lint,
  lexer_wasm,
  modify_ast_for_sketch_wasm,
  is_points_ccw,
  get_tangential_arc_to_info,
  program_memory_init,
  make_default_planes,
  coredump,
  toml_stringify,
  default_app_settings,
  parse_app_settings,
  parse_project_settings,
  default_project_settings,
  parse_project_route,
} from '../wasm-lib/pkg/wasm_lib'
import { KCLError } from './errors'
import { KclError as RustKclError } from '../wasm-lib/kcl/bindings/KclError'
import { EngineCommandManager } from './std/engineConnection'
import { ProgramReturn } from '../wasm-lib/kcl/bindings/ProgramReturn'
import { Discovered } from '../wasm-lib/kcl/bindings/Discovered'
import { MemoryItem } from '../wasm-lib/kcl/bindings/MemoryItem'
import type { Program } from '../wasm-lib/kcl/bindings/Program'
import type { Token } from '../wasm-lib/kcl/bindings/Token'
import { Coords2d } from './std/sketch'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import { CoreDumpInfo } from 'wasm-lib/kcl/bindings/CoreDumpInfo'
import { CoreDumpManager } from 'lib/coredump'
import openWindow from 'lib/openWindow'
import { DefaultPlanes } from 'wasm-lib/kcl/bindings/DefaultPlanes'
import { TEST } from 'env'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import { ProjectConfiguration } from 'wasm-lib/kcl/bindings/ProjectConfiguration'
import { ProjectRoute } from 'wasm-lib/kcl/bindings/ProjectRoute'
import { err } from 'lib/trap'

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
  try {
    const fullUrl = wasmUrl()
    const input = await fetch(fullUrl)
    const buffer = await input.arrayBuffer()
    return await init(buffer)
  } catch (e) {
    console.log('Error initialising WASM', e)
    return Promise.reject(e)
  }
}

export const initPromise = initialise()

export const rangeTypeFix = (ranges: number[][]): [number, number][] =>
  ranges.map(([start, end]) => [start, end])

export const parse = (code: string | Error): Program | Error => {
  if (err(code)) return code

  try {
    const program: Program = parse_wasm(code)
    return program
  } catch (e: any) {
    const parsed: RustKclError = JSON.parse(e.toString())
    return new KCLError(
      parsed.kind,
      parsed.msg,
      rangeTypeFix(parsed.sourceRanges)
    )
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
  programMemory: ProgramMemory | Error = { root: {}, return: null },
  engineCommandManager: EngineCommandManager,
  isMock: boolean = false
): Promise<ProgramMemory> => {
  if (err(programMemory)) return Promise.reject(programMemory)

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
  programMemory: ProgramMemory | Error = { root: {}, return: null },
  engineCommandManager: EngineCommandManager,
  isMock: boolean
): Promise<ProgramMemory> => {
  if (err(programMemory)) return Promise.reject(programMemory)

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

    return Promise.reject(kclError)
  }
}

export const kclLint = async (ast: Program): Promise<Array<Discovered>> => {
  try {
    const discovered_findings: Array<Discovered> = await kcl_lint(
      JSON.stringify(ast)
    )
    return discovered_findings
  } catch (e: any) {
    return Promise.reject(e)
  }
}

export const recast = (ast: Program): string | Error => {
  return recast_wasm(JSON.stringify(ast))
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
    return Promise.reject(e)
  }
}

export function lexer(str: string): Token[] | Error {
  return lexer_wasm(str)
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
    return Promise.reject(kclError)
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

export function programMemoryInit(): ProgramMemory | Error {
  try {
    const memory: ProgramMemory = program_memory_init()
    return memory
  } catch (e: any) {
    console.log(e)
    const parsed: RustKclError = JSON.parse(e.toString())
    return new KCLError(
      parsed.kind,
      parsed.msg,
      rangeTypeFix(parsed.sourceRanges)
    )
  }
}

export async function coreDump(
  coreDumpManager: CoreDumpManager,
  openGithubIssue: boolean = false
): Promise<CoreDumpInfo> {
  try {
    const dump: CoreDumpInfo = await coredump(coreDumpManager)
    /* NOTE: this console output of the coredump should include the field
       `github_issue_url` which is not in the uploaded coredump file.
       `github_issue_url` is added after the file is uploaded
       and is only needed for the openWindow operation which creates
       a new GitHub issue for the user.
     */
    if (openGithubIssue && dump.github_issue_url) {
      openWindow(dump.github_issue_url)
    } else {
      console.error(
        'github_issue_url undefined. Unable to create GitHub issue for coredump.'
      )
    }
    console.log('CoreDump: final coredump', dump)
    console.log('CoreDump: final coredump JSON', JSON.stringify(dump))
    return dump
  } catch (e: any) {
    console.error('CoreDump: error', e)
    return Promise.reject(new Error(`Error getting core dump: ${e}`))
  }
}

export function tomlStringify(toml: any): string | Error {
  return toml_stringify(JSON.stringify(toml))
}

export function defaultAppSettings(): Configuration | Error {
  return default_app_settings()
}

export function parseAppSettings(toml: string): Configuration | Error {
  return parse_app_settings(toml)
}

export function defaultProjectSettings(): ProjectConfiguration | Error {
  return default_project_settings()
}

export function parseProjectSettings(
  toml: string
): ProjectConfiguration | Error {
  return parse_project_settings(toml)
}

export function parseProjectRoute(
  configuration: Configuration,
  route_str: string
): ProjectRoute | Error {
  return parse_project_route(JSON.stringify(configuration), route_str)
}
