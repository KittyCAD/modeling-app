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
  modify_grid,
  coredump,
  toml_stringify,
  default_app_settings,
  parse_app_settings,
  parse_project_settings,
  default_project_settings,
  base64_decode,
} from '../wasm-lib/pkg/wasm_lib'
import { KCLError } from './errors'
import { KclError as RustKclError } from '../wasm-lib/kcl/bindings/KclError'
import { EngineCommandManager } from './std/engineConnection'
import { Discovered } from '../wasm-lib/kcl/bindings/Discovered'
import { KclValue } from '../wasm-lib/kcl/bindings/KclValue'
import type { Program } from '../wasm-lib/kcl/bindings/Program'
import type { Token } from '../wasm-lib/kcl/bindings/Token'
import { Coords2d } from './std/sketch'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import { CoreDumpInfo } from 'wasm-lib/kcl/bindings/CoreDumpInfo'
import { CoreDumpManager } from 'lib/coredump'
import openWindow from 'lib/openWindow'
import { DefaultPlanes } from 'wasm-lib/kcl/bindings/DefaultPlanes'
import { TEST } from 'env'
import { err } from 'lib/trap'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import { DeepPartial } from 'lib/types'
import { ProjectConfiguration } from 'wasm-lib/kcl/bindings/ProjectConfiguration'
import { Sketch } from '../wasm-lib/kcl/bindings/Sketch'
import { IdGenerator } from 'wasm-lib/kcl/bindings/IdGenerator'
import { ExecState as RawExecState } from '../wasm-lib/kcl/bindings/ExecState'
import { ProgramMemory as RawProgramMemory } from '../wasm-lib/kcl/bindings/ProgramMemory'
import { EnvironmentRef } from '../wasm-lib/kcl/bindings/EnvironmentRef'
import { Environment } from '../wasm-lib/kcl/bindings/Environment'

export type { Program } from '../wasm-lib/kcl/bindings/Program'
export type { Expr } from '../wasm-lib/kcl/bindings/Expr'
export type { ObjectExpression } from '../wasm-lib/kcl/bindings/ObjectExpression'
export type { ObjectProperty } from '../wasm-lib/kcl/bindings/ObjectProperty'
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
export type { Sketch } from '../wasm-lib/kcl/bindings/Sketch'
export type { Solid } from '../wasm-lib/kcl/bindings/Solid'
export type { KclValue } from '../wasm-lib/kcl/bindings/KclValue'
export type { ExtrudeSurface } from '../wasm-lib/kcl/bindings/ExtrudeSurface'

export const wasmUrl = () => {
  // For when we're in electron (file based) or web server (network based)
  // For some reason relative paths don't work as expected. Otherwise we would
  // just do /wasm_lib_bg.wasm. In particular, the issue arises when the path
  // is used from within worker.ts.
  const fullUrl = document.location.protocol.includes('http')
    ? document.location.origin + '/wasm_lib_bg.wasm'
    : document.location.protocol +
      document.location.pathname.split('/').slice(0, -1).join('/') +
      '/wasm_lib_bg.wasm'

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
    // throw e
    const parsed: RustKclError = JSON.parse(e.toString())
    return new KCLError(
      parsed.kind,
      parsed.msg,
      rangeTypeFix(parsed.sourceRanges)
    )
  }
}

export type PathToNode = [string | number, string][]

export interface ExecState {
  memory: ProgramMemory
  idGenerator: IdGenerator
}

/**
 * Create an empty ExecState.  This is useful on init to prevent needing an
 * Option.
 */
export function emptyExecState(): ExecState {
  return {
    memory: ProgramMemory.empty(),
    idGenerator: defaultIdGenerator(),
  }
}

function execStateFromRaw(raw: RawExecState): ExecState {
  return {
    memory: ProgramMemory.fromRaw(raw.memory),
    idGenerator: raw.idGenerator,
  }
}

export function defaultIdGenerator(): IdGenerator {
  return {
    nextId: 0,
    ids: [],
  }
}

interface Memory {
  [key: string]: KclValue | undefined
}

const ROOT_ENVIRONMENT_REF: EnvironmentRef = 0

function emptyEnvironment(): Environment {
  return { bindings: {}, parent: null }
}

/**
 * This duplicates logic in Rust.  The hope is to keep ProgramMemory internals
 * isolated from the rest of the TypeScript code so that we can move it to Rust
 * in the future.
 */
export class ProgramMemory {
  private environments: Environment[]
  private currentEnv: EnvironmentRef
  private return: KclValue | null

  /**
   * Empty memory doesn't include prelude definitions.
   */
  static empty(): ProgramMemory {
    return new ProgramMemory()
  }

  static fromRaw(raw: RawProgramMemory): ProgramMemory {
    return new ProgramMemory(raw.environments, raw.currentEnv, raw.return)
  }

  constructor(
    environments: Environment[] = [emptyEnvironment()],
    currentEnv: EnvironmentRef = ROOT_ENVIRONMENT_REF,
    returnVal: KclValue | null = null
  ) {
    this.environments = environments
    this.currentEnv = currentEnv
    this.return = returnVal
  }

  /**
   * Returns a deep copy.
   */
  clone(): ProgramMemory {
    return ProgramMemory.fromRaw(structuredClone(this.toRaw()))
  }

  has(name: string): boolean {
    let envRef = this.currentEnv
    while (true) {
      const env = this.environments[envRef]
      if (env.bindings.hasOwnProperty(name)) {
        return true
      }
      if (!env.parent) {
        break
      }
      envRef = env.parent
    }
    return false
  }

  get(name: string): KclValue | null {
    let envRef = this.currentEnv
    while (true) {
      const env = this.environments[envRef]
      if (env.bindings.hasOwnProperty(name)) {
        return env.bindings[name] ?? null
      }
      if (!env.parent) {
        break
      }
      envRef = env.parent
    }
    return null
  }

  set(name: string, value: KclValue): Error | null {
    if (this.environments.length === 0) {
      return new Error('No environment to set memory in')
    }
    const env = this.environments[this.currentEnv]
    env.bindings[name] = value
    return null
  }

  /**
   * Returns a new ProgramMemory with only `KclValue`s that pass the
   * predicate.  Values are deep copied.
   *
   * Note: Return value of the returned ProgramMemory is always null.
   */
  filterVariables(
    keepPrelude: boolean,
    predicate: (value: KclValue) => boolean
  ): ProgramMemory | Error {
    const environments: Environment[] = []
    for (const [i, env] of this.environments.entries()) {
      let bindings: Memory
      if (i === ROOT_ENVIRONMENT_REF && keepPrelude) {
        // Get prelude definitions.  Create these first so that they're always
        // first in iteration order.
        const memoryOrError = programMemoryInit()
        if (err(memoryOrError)) return memoryOrError
        bindings = memoryOrError.environments[0].bindings
      } else {
        bindings = emptyEnvironment().bindings
      }

      for (const [name, value] of Object.entries(env.bindings)) {
        if (value === undefined) continue
        // Check the predicate.
        if (!predicate(value)) {
          continue
        }
        // Deep copy.
        bindings[name] = structuredClone(value)
      }
      environments.push({ bindings, parent: env.parent })
    }
    return new ProgramMemory(environments, this.currentEnv, null)
  }

  numEnvironments(): number {
    return this.environments.length
  }

  numVariables(envRef: EnvironmentRef): number {
    return Object.keys(this.environments[envRef]).length
  }

  /**
   * Returns all variable entries in memory that are visible, in a flat
   * structure.  If variables are shadowed, they're not visible, and therefore,
   * not included.
   *
   * This should only be used to display in the MemoryPane UI.
   */
  visibleEntries(): Map<string, KclValue> {
    const map = new Map<string, KclValue>()
    let envRef = this.currentEnv
    while (true) {
      const env = this.environments[envRef]
      for (const [name, value] of Object.entries(env.bindings)) {
        if (value === undefined) continue
        // Don't include shadowed variables.
        if (!map.has(name)) {
          map.set(name, value)
        }
      }
      if (!env.parent) {
        break
      }
      envRef = env.parent
    }
    return map
  }

  /**
   * Returns true if any visible variables are a Sketch or Solid.
   */
  hasSketchOrSolid(): boolean {
    for (const node of this.visibleEntries().values()) {
      if (node.type === 'Solid' || node.value?.type === 'Sketch') {
        return true
      }
    }
    return false
  }

  /**
   * Return the representation that can be serialized to JSON.  This should only
   * be used within this module.
   */
  toRaw(): RawProgramMemory {
    return {
      environments: this.environments,
      currentEnv: this.currentEnv,
      return: this.return,
    }
  }
}

// TODO: In the future, make the parameter be a KclValue.
export function sketchFromKclValue(
  obj: any,
  varName: string | null
): Sketch | Error {
  if (obj?.value?.type === 'Sketch') return obj.value
  if (obj?.type === 'Sketch') return obj
  if (obj?.value?.type === 'Solid') return obj.value.sketch
  if (obj?.type === 'Solid') return obj.sketch
  if (!varName) {
    varName = 'a KCL value'
  }
  const actualType = obj?.value?.type ?? obj?.type
  if (actualType) {
    console.log('THIS IS ERROR SG', obj)
    return new Error(
      `Expected ${varName} to be a sketch or solid, but it was ${actualType} instead.`
    )
  } else {
    return new Error(`Expected ${varName} to be a sketch, but it wasn't.`)
  }
}

export const executor = async (
  node: Program,
  programMemory: ProgramMemory | Error = ProgramMemory.empty(),
  idGenerator: IdGenerator = defaultIdGenerator(),
  engineCommandManager: EngineCommandManager,
  isMock: boolean = false
): Promise<ExecState> => {
  if (err(programMemory)) return Promise.reject(programMemory)

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  engineCommandManager.startNewSession()
  const _programMemory = await _executor(
    node,
    programMemory,
    idGenerator,
    engineCommandManager,
    isMock
  )
  await engineCommandManager.waitForAllCommands()

  engineCommandManager.endSession()
  return _programMemory
}

export const _executor = async (
  node: Program,
  programMemory: ProgramMemory | Error = ProgramMemory.empty(),
  idGenerator: IdGenerator = defaultIdGenerator(),
  engineCommandManager: EngineCommandManager,
  isMock: boolean
): Promise<ExecState> => {
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
    const execState: RawExecState = await execute_wasm(
      JSON.stringify(node),
      JSON.stringify(programMemory.toRaw()),
      JSON.stringify(idGenerator),
      baseUnit,
      engineCommandManager,
      fileSystemManager,
      undefined,
      isMock
    )
    return execStateFromRaw(execState)
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

export const modifyGrid = async (
  engineCommandManager: EngineCommandManager,
  hidden: boolean
): Promise<void> => {
  try {
    await modify_grid(engineCommandManager, hidden)
    return
  } catch (e) {
    // TODO: do something real with the error.
    console.log('modify grid error', e)
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

/**
 * Returns new ProgramMemory with prelude definitions.
 */
export function programMemoryInit(): ProgramMemory | Error {
  try {
    const memory: RawProgramMemory = program_memory_init()
    return new ProgramMemory(
      memory.environments,
      memory.currentEnv,
      memory.return
    )
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
    console.warn('CoreDump: Initializing core dump')
    const dump: CoreDumpInfo = await coredump(coreDumpManager)
    /* NOTE: this console output of the coredump should include the field
       `github_issue_url` which is not in the uploaded coredump file.
       `github_issue_url` is added after the file is uploaded
       and is only needed for the openWindow operation which creates
       a new GitHub issue for the user.
     */
    if (openGithubIssue && dump.github_issue_url) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
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

export function defaultAppSettings(): DeepPartial<Configuration> | Error {
  return default_app_settings()
}

export function parseAppSettings(
  toml: string
): DeepPartial<Configuration> | Error {
  return parse_app_settings(toml)
}

export function defaultProjectSettings():
  | DeepPartial<ProjectConfiguration>
  | Error {
  return default_project_settings()
}

export function parseProjectSettings(
  toml: string
): DeepPartial<ProjectConfiguration> | Error {
  return parse_project_settings(toml)
}

export function base64Decode(base64: string): ArrayBuffer | Error {
  try {
    const decoded = base64_decode(base64)
    return new Uint8Array(decoded).buffer
  } catch (e) {
    console.error('Caught error decoding base64 string: ' + e)
    return new Error('Caught error decoding base64 string: ' + e)
  }
}
