import {
  init,
  parse_wasm,
  recast_wasm,
  format_number,
  execute,
  kcl_lint,
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
  base64_decode,
  clear_scene_and_bust_cache,
  kcl_settings,
  change_kcl_settings,
  reloadModule,
} from 'lib/wasm_lib_wrapper'

import { KCLError } from './errors'
import { KclError as RustKclError } from '../wasm-lib/kcl/bindings/KclError'
import { EngineCommandManager } from './std/engineConnection'
import { Discovered } from '../wasm-lib/kcl/bindings/Discovered'
import { KclValue } from '../wasm-lib/kcl/bindings/KclValue'
import type { Program } from '../wasm-lib/kcl/bindings/Program'
import { Coords2d } from './std/sketch'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import { CoreDumpInfo } from 'wasm-lib/kcl/bindings/CoreDumpInfo'
import { CoreDumpManager } from 'lib/coredump'
import openWindow from 'lib/openWindow'
import { DefaultPlanes } from 'wasm-lib/kcl/bindings/DefaultPlanes'
import { TEST } from 'env'
import { err, Reason } from 'lib/trap'
import { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
import { DeepPartial } from 'lib/types'
import { ProjectConfiguration } from 'wasm-lib/kcl/bindings/ProjectConfiguration'
import { Sketch } from '../wasm-lib/kcl/bindings/Sketch'
import { ExecOutcome as RustExecOutcome } from 'wasm-lib/kcl/bindings/ExecOutcome'
import { ProgramMemory as RawProgramMemory } from '../wasm-lib/kcl/bindings/ProgramMemory'
import { EnvironmentRef } from '../wasm-lib/kcl/bindings/EnvironmentRef'
import { Environment } from '../wasm-lib/kcl/bindings/Environment'
import { Node } from 'wasm-lib/kcl/bindings/Node'
import { CompilationError } from 'wasm-lib/kcl/bindings/CompilationError'
import { SourceRange } from 'wasm-lib/kcl/bindings/SourceRange'
import { getAllCurrentSettings } from 'lib/settings/settingsUtils'
import { Operation } from 'wasm-lib/kcl/bindings/Operation'
import { KclErrorWithOutputs } from 'wasm-lib/kcl/bindings/KclErrorWithOutputs'
import { Artifact as RustArtifact } from 'wasm-lib/kcl/bindings/Artifact'
import { ArtifactId } from 'wasm-lib/kcl/bindings/Artifact'
import { ArtifactCommand } from 'wasm-lib/kcl/bindings/Artifact'
import { ArtifactGraph as RustArtifactGraph } from 'wasm-lib/kcl/bindings/Artifact'
import { Artifact } from './std/artifactGraph'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import { NumericSuffix } from 'wasm-lib/kcl/bindings/NumericSuffix'
import { MetaSettings } from 'wasm-lib/kcl/bindings/MetaSettings'
import { UnitAngle, UnitLength } from 'wasm-lib/kcl/bindings/ModelingCmd'
import { UnitLen } from 'wasm-lib/kcl/bindings/UnitLen'
import { UnitAngle as UnitAng } from 'wasm-lib/kcl/bindings/UnitAngle'

export type { Artifact } from 'wasm-lib/kcl/bindings/Artifact'
export type { ArtifactCommand } from 'wasm-lib/kcl/bindings/Artifact'
export type { ArtifactId } from 'wasm-lib/kcl/bindings/Artifact'
export type { Cap as CapArtifact } from 'wasm-lib/kcl/bindings/Artifact'
export type { CodeRef } from 'wasm-lib/kcl/bindings/Artifact'
export type { EdgeCut } from 'wasm-lib/kcl/bindings/Artifact'
export type { Path as PathArtifact } from 'wasm-lib/kcl/bindings/Artifact'
export type { Plane as PlaneArtifact } from 'wasm-lib/kcl/bindings/Artifact'
export type { Segment as SegmentArtifact } from 'wasm-lib/kcl/bindings/Artifact'
export type { Solid2d as Solid2dArtifact } from 'wasm-lib/kcl/bindings/Artifact'
export type { Sweep as SweepArtifact } from 'wasm-lib/kcl/bindings/Artifact'
export type { SweepEdge } from 'wasm-lib/kcl/bindings/Artifact'
export type { Wall as WallArtifact } from 'wasm-lib/kcl/bindings/Artifact'
export type { Configuration } from 'wasm-lib/kcl/bindings/Configuration'
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
export type { CallExpressionKw } from '../wasm-lib/kcl/bindings/CallExpressionKw'
export type { LabeledArg } from '../wasm-lib/kcl/bindings/LabeledArg'
export type { VariableDeclarator } from '../wasm-lib/kcl/bindings/VariableDeclarator'
export type { BinaryPart } from '../wasm-lib/kcl/bindings/BinaryPart'
export type { Literal } from '../wasm-lib/kcl/bindings/Literal'
export type { LiteralValue } from '../wasm-lib/kcl/bindings/LiteralValue'
export type { ArrayExpression } from '../wasm-lib/kcl/bindings/ArrayExpression'
export type { SourceRange } from 'wasm-lib/kcl/bindings/SourceRange'
export type { NumericSuffix } from 'wasm-lib/kcl/bindings/NumericSuffix'

export type SyntaxType =
  | 'Program'
  | 'ExpressionStatement'
  | 'BinaryExpression'
  | 'CallExpression'
  | 'CallExpressionKw'
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
  | 'LiteralValue'
  | 'NonCodeNode'
  | 'UnaryExpression'

export type { Path } from '../wasm-lib/kcl/bindings/Path'
export type { Sketch } from '../wasm-lib/kcl/bindings/Sketch'
export type { Solid } from '../wasm-lib/kcl/bindings/Solid'
export type { KclValue } from '../wasm-lib/kcl/bindings/KclValue'
export type { ExtrudeSurface } from '../wasm-lib/kcl/bindings/ExtrudeSurface'

/**
 * Convert a SourceRange as used inside the KCL interpreter into the above one for use in the
 * frontend (essentially we're eagerly checking whether the frontend should care about the SourceRange
 * so as not to expose details of the interpreter's current representation of module ids throughout
 * the frontend).
 */
export function sourceRangeFromRust(s: SourceRange): SourceRange {
  return [s[0], s[1], s[2]]
}

/**
 * Create a default SourceRange for testing or as a placeholder.
 */
export function defaultSourceRange(): SourceRange {
  return [0, 0, 0]
}

/**
 * Create a SourceRange for the top-level module.
 */
export function topLevelRange(start: number, end: number): SourceRange {
  return [start, end, 0]
}

/**
 * Returns true if this source range is from the file being executed.  Returns
 * false if it's from a file that was imported.
 */
export function isTopLevelModule(range: SourceRange): boolean {
  return range[2] === 0
}

function firstSourceRange(error: RustKclError): SourceRange {
  return error.sourceRanges.length > 0
    ? sourceRangeFromRust(error.sourceRanges[0])
    : defaultSourceRange()
}

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
    await reloadModule()
    const fullUrl = wasmUrl()
    const input = await fetch(fullUrl)
    const buffer = await input.arrayBuffer()
    return await init({ module_or_path: buffer })
  } catch (e) {
    console.log('Error initialising WASM', e)
    return Promise.reject(e)
  }
}

export const initPromise = initialise()

const splitErrors = (
  input: CompilationError[]
): { errors: CompilationError[]; warnings: CompilationError[] } => {
  let errors = []
  let warnings = []
  for (const i of input) {
    if (i.severity === 'Warning') {
      warnings.push(i)
    } else {
      errors.push(i)
    }
  }

  return { errors, warnings }
}

export class ParseResult {
  program: Node<Program> | null
  errors: CompilationError[]
  warnings: CompilationError[]

  constructor(
    program: Node<Program> | null,
    errors: CompilationError[],
    warnings: CompilationError[]
  ) {
    this.program = program
    this.errors = errors
    this.warnings = warnings
  }
}

/**
 * Parsing was successful. There is guaranteed to be an AST and no fatal errors. There may or may
 * not be warnings or non-fatal errors.
 */
class SuccessParseResult extends ParseResult {
  program: Node<Program>

  constructor(
    program: Node<Program>,
    errors: CompilationError[],
    warnings: CompilationError[]
  ) {
    super(program, errors, warnings)
    this.program = program
  }
}

export function resultIsOk(result: ParseResult): result is SuccessParseResult {
  return !!result.program && result.errors.length === 0
}

export const parse = (code: string | Error): ParseResult | Error => {
  if (err(code)) return code

  try {
    const parsed: [Node<Program>, CompilationError[]] = parse_wasm(code)
    let errs = splitErrors(parsed[1])
    return new ParseResult(parsed[0], errs.errors, errs.warnings)
  } catch (e: any) {
    // throw e
    console.error(e.toString())
    const parsed: RustKclError = JSON.parse(e.toString())
    return new KCLError(
      parsed.kind,
      parsed.msg,
      firstSourceRange(parsed),
      [],
      [],
      defaultArtifactGraph()
    )
  }
}

// Parse and throw an exception if there are any errors (probably not suitable for use outside of testing).
export const assertParse = (code: string): Node<Program> => {
  const result = parse(code)
  // eslint-disable-next-line suggest-no-throw/suggest-no-throw
  if (err(result) || !resultIsOk(result)) throw result
  return result.program
}

export type PathToNode = [string | number, string][]

export const isPathToNodeNumber = (
  pathToNode: string | number
): pathToNode is number => {
  return typeof pathToNode === 'number'
}

export interface ExecState {
  memory: ProgramMemory
  operations: Operation[]
  artifacts: { [key in ArtifactId]?: RustArtifact }
  artifactCommands: ArtifactCommand[]
  artifactGraph: ArtifactGraph
}

/**
 * Create an empty ExecState.  This is useful on init to prevent needing an
 * Option.
 */
export function emptyExecState(): ExecState {
  return {
    memory: ProgramMemory.empty(),
    operations: [],
    artifacts: {},
    artifactCommands: [],
    artifactGraph: defaultArtifactGraph(),
  }
}

function execStateFromRust(
  execOutcome: RustExecOutcome,
  program: Node<Program>
): ExecState {
  const artifactGraph = rustArtifactGraphToMap(execOutcome.artifactGraph)
  // We haven't ported pathToNode logic to Rust yet, so we need to fill it in.
  for (const [id, artifact] of artifactGraph) {
    if (!artifact) continue
    if (!('codeRef' in artifact)) continue
    const pathToNode = getNodePathFromSourceRange(
      program,
      sourceRangeFromRust(artifact.codeRef.range)
    )
    artifact.codeRef.pathToNode = pathToNode
  }

  return {
    memory: ProgramMemory.fromRaw(execOutcome.memory),
    operations: execOutcome.operations,
    artifacts: execOutcome.artifacts,
    artifactCommands: execOutcome.artifactCommands,
    artifactGraph,
  }
}

export type ArtifactGraph = Map<ArtifactId, Artifact>

function rustArtifactGraphToMap(
  rustArtifactGraph: RustArtifactGraph
): ArtifactGraph {
  const map = new Map<ArtifactId, Artifact>()
  for (const [id, artifact] of Object.entries(rustArtifactGraph.map)) {
    if (!artifact) continue
    map.set(id, artifact)
  }

  return map
}

export function defaultArtifactGraph(): ArtifactGraph {
  return new Map()
}

interface Memory {
  [key: string]: KclValue | undefined
}

const ROOT_ENVIRONMENT_REF: EnvironmentRef = 0

function emptyEnvironment(): Environment {
  return { bindings: {}, parent: null }
}

function emptyRootEnvironment(): Environment {
  return {
    // This is dumb this is copied from rust.
    bindings: {
      ZERO: { type: 'Number', value: 0.0, __meta: [] },
      QUARTER_TURN: { type: 'Number', value: 90.0, __meta: [] },
      HALF_TURN: { type: 'Number', value: 180.0, __meta: [] },
      THREE_QUARTER_TURN: { type: 'Number', value: 270.0, __meta: [] },
    },
    parent: null,
  }
}

/**
 * This duplicates logic in Rust.  The hope is to keep ProgramMemory internals
 * isolated from the rest of the TypeScript code so that we can move it to Rust
 * in the future.
 */
export class ProgramMemory {
  private environments: Environment[]
  private currentEnv: EnvironmentRef

  /**
   * Empty memory doesn't include prelude definitions.
   */
  static empty(): ProgramMemory {
    return new ProgramMemory()
  }

  static fromRaw(raw: RawProgramMemory): ProgramMemory {
    return new ProgramMemory(raw.environments, raw.currentEnv)
  }

  constructor(
    environments: Environment[] = [emptyRootEnvironment()],
    currentEnv: EnvironmentRef = ROOT_ENVIRONMENT_REF
  ) {
    this.environments = environments
    this.currentEnv = currentEnv
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

  insert(name: string, value: KclValue): Error | null {
    if (this.environments.length === 0) {
      return new Error('No environment to set memory in')
    }
    const env = this.environments[this.currentEnv]
    if (!!env.bindings[name]) {
      return new Error('Key already exists in memory: ' + name)
    }
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
    return new ProgramMemory(environments, this.currentEnv)
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
      if (node.type === 'Solid' || node.type === 'Sketch') {
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
    }
  }
}

// TODO: In the future, make the parameter be a KclValue.
export function sketchFromKclValueOptional(
  obj: any,
  varName: string | null
): Sketch | Reason {
  if (obj?.value?.type === 'Sketch') return obj.value
  if (obj?.value?.type === 'Solid') return obj.value.sketch
  if (obj?.type === 'Sketch') return obj.value
  if (obj?.type === 'Solid') return obj.value.sketch
  if (!varName) {
    varName = 'a KCL value'
  }
  const actualType = obj?.value?.type ?? obj?.type
  if (actualType) {
    return new Reason(
      `Expected ${varName} to be a sketch or solid, but it was ${actualType} instead.`
    )
  } else {
    return new Reason(`Expected ${varName} to be a sketch, but it wasn't.`)
  }
}

// TODO: In the future, make the parameter be a KclValue.
export function sketchFromKclValue(
  obj: any,
  varName: string | null
): Sketch | Error {
  const result = sketchFromKclValueOptional(obj, varName)
  if (result instanceof Reason) {
    return result.toError()
  }
  return result
}

/**
 * Execute a KCL program.
 * @param node The AST of the program to execute.
 * @param path The full path of the file being executed.  Use `null` for
 * expressions that don't have a file, like expressions in the command bar.
 * @param programMemoryOverride If this is not `null`, this will be used as the
 * initial program memory, and the execution will be engineless (AKA mock
 * execution).
 */
export const executor = async (
  node: Node<Program>,
  engineCommandManager: EngineCommandManager,
  path?: string,
  programMemoryOverride: ProgramMemory | Error | null = null
): Promise<ExecState> => {
  if (programMemoryOverride !== null && err(programMemoryOverride))
    return Promise.reject(programMemoryOverride)

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  if (programMemoryOverride !== null && err(programMemoryOverride))
    return Promise.reject(programMemoryOverride)

  try {
    let jsAppSettings = default_app_settings()
    if (!TEST) {
      const lastSettingsSnapshot = await import(
        'components/SettingsAuthProvider'
      ).then((module) => module.lastSettingsContextSnapshot)
      if (lastSettingsSnapshot) {
        jsAppSettings = getAllCurrentSettings(lastSettingsSnapshot)
      }
    }
    const execOutcome: RustExecOutcome = await execute(
      JSON.stringify(node),
      path,
      JSON.stringify(programMemoryOverride?.toRaw() || null),
      JSON.stringify({ settings: jsAppSettings }),
      engineCommandManager,
      fileSystemManager
    )
    return execStateFromRust(execOutcome, node)
  } catch (e: any) {
    console.log(e)
    const parsed: KclErrorWithOutputs = JSON.parse(e.toString())
    const kclError = new KCLError(
      parsed.error.kind,
      parsed.error.msg,
      firstSourceRange(parsed.error),
      parsed.operations,
      parsed.artifactCommands,
      rustArtifactGraphToMap(parsed.artifactGraph)
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

/**
 * Format a number with suffix as KCL.
 */
export function formatNumber(value: number, suffix: NumericSuffix): string {
  return format_number(value, JSON.stringify(suffix))
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

export const modifyAstForSketch = async (
  engineCommandManager: EngineCommandManager,
  ast: Node<Program>,
  variableName: string,
  currentPlane: string,
  engineId: string
): Promise<Node<Program>> => {
  try {
    const updatedAst: Node<Program> = await modify_ast_for_sketch_wasm(
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
      firstSourceRange(parsed),
      [],
      [],
      defaultArtifactGraph()
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
    return new ProgramMemory(memory.environments, memory.currentEnv)
  } catch (e: any) {
    console.log(e)
    const parsed: RustKclError = JSON.parse(e.toString())
    return new KCLError(
      parsed.kind,
      parsed.msg,
      firstSourceRange(parsed),
      [],
      [],
      defaultArtifactGraph()
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

export async function clearSceneAndBustCache(
  engineCommandManager: EngineCommandManager
): Promise<null | Error> {
  try {
    await clear_scene_and_bust_cache(engineCommandManager)
  } catch (e: any) {
    console.error('clear_scene_and_bust_cache: error', e)
    return Promise.reject(
      new Error(`Error on clear_scene_and_bust_cache: ${e}`)
    )
  }

  return null
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

/**
 * Get the meta settings for the KCL.  If no settings were set in the file,
 * returns null.
 */
export function kclSettings(
  kcl: string | Node<Program>
): MetaSettings | null | Error {
  let program: Node<Program>
  if (typeof kcl === 'string') {
    const parseResult = parse(kcl)
    if (err(parseResult)) return parseResult
    if (!resultIsOk(parseResult)) {
      return new Error(`parse result had errors`, { cause: parseResult })
    }
    program = parseResult.program
  } else {
    program = kcl
  }
  try {
    return kcl_settings(JSON.stringify(program))
  } catch (e) {
    return new Error('Caught error getting kcl settings', { cause: e })
  }
}

/**
 * Change the meta settings for the kcl file.
 * @returns the new kcl string with the updated settings.
 */
export function changeKclSettings(
  kcl: string,
  settings: MetaSettings
): string | Error {
  try {
    return change_kcl_settings(kcl, JSON.stringify(settings))
  } catch (e) {
    console.error('Caught error changing kcl settings', e)
    return new Error('Caught error changing kcl settings', { cause: e })
  }
}

/**
 * Convert a `UnitLength_type` to a `UnitLen`
 */
export function unitLengthToUnitLen(input: UnitLength): UnitLen {
  switch (input) {
    case 'm':
      return { type: 'M' }
    case 'cm':
      return { type: 'Cm' }
    case 'yd':
      return { type: 'Yards' }
    case 'ft':
      return { type: 'Feet' }
    case 'in':
      return { type: 'Inches' }
    default:
      return { type: 'Mm' }
  }
}

/**
 * Convert `UnitLen` to `UnitLength_type`.
 */
export function unitLenToUnitLength(input: UnitLen): UnitLength {
  switch (input.type) {
    case 'M':
      return 'm'
    case 'Cm':
      return 'cm'
    case 'Yards':
      return 'yd'
    case 'Feet':
      return 'ft'
    case 'Inches':
      return 'in'
    default:
      return 'mm'
  }
}

/**
 * Convert `UnitAngle` to `UnitAngle_type`.
 */
export function unitAngToUnitAngle(input: UnitAng): UnitAngle {
  switch (input.type) {
    case 'Radians':
      return 'radians'
    default:
      return 'degrees'
  }
}
