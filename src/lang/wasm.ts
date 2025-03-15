import {
  init,
  parse_wasm,
  recast_wasm,
  format_number,
  execute_mock,
  kcl_lint,
  is_points_ccw,
  get_tangential_arc_to_info,
  get_kcl_version,
  coredump,
  default_app_settings,
  parse_app_settings,
  parse_project_settings,
  default_project_settings,
  base64_decode,
  clear_scene_and_bust_cache,
  kcl_settings,
  change_kcl_settings,
  serialize_project_configuration,
  serialize_configuration,
  reloadModule,
} from 'lib/wasm_lib_wrapper'

import { KCLError } from './errors'
import { KclError as RustKclError } from '@rust/kcl-lib/bindings/KclError'
import { EngineCommandManager } from './std/engineConnection'
import { Discovered } from '@rust/kcl-lib/bindings/Discovered'
import { KclValue } from '@rust/kcl-lib/bindings/KclValue'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import { Coords2d } from './std/sketch'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import { CoreDumpInfo } from '@rust/kcl-lib/bindings/CoreDumpInfo'
import { CoreDumpManager } from 'lib/coredump'
import openWindow from 'lib/openWindow'
import { TEST } from 'env'
import { err, Reason } from 'lib/trap'
import { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import { DeepPartial } from 'lib/types'
import { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'
import { Sketch } from '@rust/kcl-lib/bindings/Sketch'
import { ExecOutcome as RustExecOutcome } from '@rust/kcl-lib/bindings/ExecOutcome'
import { Node } from '@rust/kcl-lib/bindings/Node'
import { CompilationError } from '@rust/kcl-lib/bindings/CompilationError'
import { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import { getAllCurrentSettings } from 'lib/settings/settingsUtils'
import { Operation } from '@rust/kcl-lib/bindings/Operation'
import { KclErrorWithOutputs } from '@rust/kcl-lib/bindings/KclErrorWithOutputs'
import { Artifact as RustArtifact } from '@rust/kcl-lib/bindings/Artifact'
import { ArtifactId } from '@rust/kcl-lib/bindings/Artifact'
import { ArtifactCommand } from '@rust/kcl-lib/bindings/Artifact'
import { ArtifactGraph as RustArtifactGraph } from '@rust/kcl-lib/bindings/Artifact'
import { Artifact } from './std/artifactGraph'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import { MetaSettings } from '@rust/kcl-lib/bindings/MetaSettings'
import { UnitAngle, UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import { UnitLen } from '@rust/kcl-lib/bindings/UnitLen'
import { UnitAngle as UnitAng } from '@rust/kcl-lib/bindings/UnitAngle'
import { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'

export type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
export type { ArtifactCommand } from '@rust/kcl-lib/bindings/Artifact'
export type { ArtifactId } from '@rust/kcl-lib/bindings/Artifact'
export type { Cap as CapArtifact } from '@rust/kcl-lib/bindings/Artifact'
export type { CodeRef } from '@rust/kcl-lib/bindings/Artifact'
export type { EdgeCut } from '@rust/kcl-lib/bindings/Artifact'
export type { Path as PathArtifact } from '@rust/kcl-lib/bindings/Artifact'
export type { Plane as PlaneArtifact } from '@rust/kcl-lib/bindings/Artifact'
export type { Segment as SegmentArtifact } from '@rust/kcl-lib/bindings/Artifact'
export type { Solid2d as Solid2dArtifact } from '@rust/kcl-lib/bindings/Artifact'
export type { Sweep as SweepArtifact } from '@rust/kcl-lib/bindings/Artifact'
export type { SweepEdge } from '@rust/kcl-lib/bindings/Artifact'
export type { Wall as WallArtifact } from '@rust/kcl-lib/bindings/Artifact'
export type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
export type { Program } from '@rust/kcl-lib/bindings/Program'
export type { Expr } from '@rust/kcl-lib/bindings/Expr'
export type { ObjectExpression } from '@rust/kcl-lib/bindings/ObjectExpression'
export type { ObjectProperty } from '@rust/kcl-lib/bindings/ObjectProperty'
export type { MemberExpression } from '@rust/kcl-lib/bindings/MemberExpression'
export type { PipeExpression } from '@rust/kcl-lib/bindings/PipeExpression'
export type { VariableDeclaration } from '@rust/kcl-lib/bindings/VariableDeclaration'
export type { Parameter } from '@rust/kcl-lib/bindings/Parameter'
export type { PipeSubstitution } from '@rust/kcl-lib/bindings/PipeSubstitution'
export type { Identifier } from '@rust/kcl-lib/bindings/Identifier'
export type { UnaryExpression } from '@rust/kcl-lib/bindings/UnaryExpression'
export type { BinaryExpression } from '@rust/kcl-lib/bindings/BinaryExpression'
export type { ReturnStatement } from '@rust/kcl-lib/bindings/ReturnStatement'
export type { ExpressionStatement } from '@rust/kcl-lib/bindings/ExpressionStatement'
export type { CallExpression } from '@rust/kcl-lib/bindings/CallExpression'
export type { CallExpressionKw } from '@rust/kcl-lib/bindings/CallExpressionKw'
export type { LabeledArg } from '@rust/kcl-lib/bindings/LabeledArg'
export type { VariableDeclarator } from '@rust/kcl-lib/bindings/VariableDeclarator'
export type { BinaryPart } from '@rust/kcl-lib/bindings/BinaryPart'
export type { Literal } from '@rust/kcl-lib/bindings/Literal'
export type { LiteralValue } from '@rust/kcl-lib/bindings/LiteralValue'
export type { ArrayExpression } from '@rust/kcl-lib/bindings/ArrayExpression'
export type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
export type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'

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

export type { Path } from '@rust/kcl-lib/bindings/Path'
export type { Sketch } from '@rust/kcl-lib/bindings/Sketch'
export type { Solid } from '@rust/kcl-lib/bindings/Solid'
export type { KclValue } from '@rust/kcl-lib/bindings/KclValue'
export type { ExtrudeSurface } from '@rust/kcl-lib/bindings/ExtrudeSurface'

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
    ? document.location.origin + '/kcl_wasm_lib_bg.wasm'
    : document.location.protocol +
      document.location.pathname.split('/').slice(0, -1).join('/') +
      '/kcl_wasm_lib_bg.wasm'

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
      defaultArtifactGraph(),
      {}
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

export type VariableMap = { [key in string]?: KclValue }

export type PathToNode = [string | number, string][]

export const isPathToNodeNumber = (
  pathToNode: string | number
): pathToNode is number => {
  return typeof pathToNode === 'number'
}

export interface ExecState {
  variables: { [key in string]?: KclValue }
  operations: Operation[]
  artifactCommands: ArtifactCommand[]
  artifactGraph: ArtifactGraph
  errors: CompilationError[]
  filenames: { [x: number]: ModulePath | undefined }
}

/**
 * Create an empty ExecState.  This is useful on init to prevent needing an
 * Option.
 */
export function emptyExecState(): ExecState {
  return {
    variables: {},
    operations: [],
    artifactCommands: [],
    artifactGraph: defaultArtifactGraph(),
    errors: [],
    filenames: [],
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
    variables: execOutcome.variables,
    operations: execOutcome.operations,
    artifactCommands: execOutcome.artifactCommands,
    artifactGraph,
    errors: execOutcome.errors,
    filenames: execOutcome.filenames,
  }
}

function mockExecStateFromRust(execOutcome: RustExecOutcome): ExecState {
  return {
    variables: execOutcome.variables,
    operations: execOutcome.operations,
    artifactCommands: execOutcome.artifactCommands,
    artifactGraph: new Map<ArtifactId, Artifact>(),
    errors: execOutcome.errors,
    filenames: execOutcome.filenames,
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
 */
export const executeMock = async (
  node: Node<Program>,
  usePrevMemory?: boolean,
  path?: string
): Promise<ExecState> => {
  try {
    if (usePrevMemory === undefined) {
      usePrevMemory = true
    }
    const execOutcome: RustExecOutcome = await execute_mock(
      JSON.stringify(node),
      path,
      JSON.stringify({ settings: await jsAppSettings() }),
      usePrevMemory,
      fileSystemManager
    )
    return mockExecStateFromRust(execOutcome)
  } catch (e: any) {
    return Promise.reject(errFromErrWithOutputs(e))
  }
}

/**
 * Execute a KCL program.
 * @param node The AST of the program to execute.
 * @param path The full path of the file being executed.  Use `null` for
 * expressions that don't have a file, like expressions in the command bar.
 */
export const executeWithEngine = async (
  node: Node<Program>,
  engineCommandManager: EngineCommandManager,
  path?: string
): Promise<ExecState> => {
  try {
    const execOutcome: RustExecOutcome = await execute_with_engine(
      JSON.stringify(node),
      path,
      JSON.stringify({ settings: await jsAppSettings() }),
      engineCommandManager,
      fileSystemManager
    )
    return execStateFromRust(execOutcome, node)
  } catch (e: any) {
    return Promise.reject(errFromErrWithOutputs(e))
  }
}

const jsAppSettings = async () => {
  let jsAppSettings = default_app_settings()
  if (!TEST) {
    const settings = await import('machines/appMachine').then((module) =>
      module.getSettings()
    )
    if (settings) {
      jsAppSettings = getAllCurrentSettings(settings)
    }
  }
  return jsAppSettings
}

const errFromErrWithOutputs = (e: any): KCLError => {
  const parsed: KclErrorWithOutputs = JSON.parse(e.toString())
  return new KCLError(
    parsed.error.kind,
    parsed.error.msg,
    firstSourceRange(parsed.error),
    parsed.operations,
    parsed.artifactCommands,
    rustArtifactGraphToMap(parsed.artifactGraph),
    parsed.filenames
  )
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

/**
 * Get the KCL version currently being used.
 */
export function getKclVersion(): string {
  return get_kcl_version()
}

/**
 * Serialize a project configuration to a TOML string.
 */
export function serializeConfiguration(configuration: any): string | Error {
  try {
    return serialize_configuration(configuration)
  } catch (e: any) {
    return new Error(`Error serializing configuration: ${e}`)
  }
}

/**
 * Serialize a project configuration to a TOML string.
 */
export function serializeProjectConfiguration(
  configuration: any
): string | Error {
  try {
    return serialize_project_configuration(configuration)
  } catch (e: any) {
    return new Error(`Error serializing project configuration: ${e}`)
  }
}
