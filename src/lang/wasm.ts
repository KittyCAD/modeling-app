import type { ArtifactGraph as RustArtifactGraph } from '@rust/kcl-lib/bindings/Artifact'
import type { ArtifactId } from '@rust/kcl-lib/bindings/ArtifactId'
import type { CompilationError } from '@rust/kcl-lib/bindings/CompilationError'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { CoreDumpInfo } from '@rust/kcl-lib/bindings/CoreDumpInfo'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import type { Discovered } from '@rust/kcl-lib/bindings/Discovered'
import type { ExecOutcome as RustExecOutcome } from '@rust/kcl-lib/bindings/ExecOutcome'
import type { KclError as RustKclError } from '@rust/kcl-lib/bindings/KclError'
import type { KclErrorWithOutputs } from '@rust/kcl-lib/bindings/KclErrorWithOutputs'
import type { KclValue } from '@rust/kcl-lib/bindings/KclValue'
import type { MetaSettings } from '@rust/kcl-lib/bindings/MetaSettings'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { NodePath } from '@rust/kcl-lib/bindings/NodePath'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'
import type { Sketch } from '@rust/kcl-lib/bindings/Sketch'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'

import type { NumericType } from '@rust/kcl-lib/bindings/NumericType'
import { KCLError } from '@src/lang/errors'
import {
  ARG_INDEX_FIELD,
  LABELED_ARG_FIELD,
  UNLABELED_ARG,
} from '@src/lang/queryAstConstants'
import { defaultSourceRange, sourceRangeFromRust } from '@src/lang/sourceRange'
import {
  type Artifact,
  defaultArtifactGraph,
} from '@src/lang/std/artifactGraph'
import type { Coords2d } from '@src/lang/util'
import { isTopLevelModule } from '@src/lang/util'
import type { CoreDumpManager } from '@src/lib/coredump'
import openWindow from '@src/lib/openWindow'
import { Reason, err } from '@src/lib/trap'
import type { DeepPartial } from '@src/lib/types'
import { isArray } from '@src/lib/utils'
import {
  base64_decode,
  change_default_units,
  change_experimental_features,
  coredump,
  default_app_settings,
  default_project_settings,
  format_number_literal,
  format_number_value,
  get_kcl_version,
  get_tangential_arc_to_info,
  human_display_number,
  is_kcl_empty_or_only_settings,
  is_points_ccw,
  kcl_lint,
  kcl_settings,
  node_path_from_range,
  parse_app_settings,
  parse_project_settings,
  parse_wasm,
  recast_wasm,
  serialize_configuration,
  serialize_project_configuration,
} from '@src/lib/wasm_lib_wrapper'

export type { ArrayExpression } from '@rust/kcl-lib/bindings/ArrayExpression'
export type {
  Artifact,
  Cap as CapArtifact,
  CodeRef,
  CompositeSolid as CompositeSolidArtifact,
  EdgeCut,
  Path as PathArtifact,
  Plane as PlaneArtifact,
  Segment as SegmentArtifact,
  Solid2d as Solid2dArtifact,
  Sweep as SweepArtifact,
  SweepEdge,
  Wall as WallArtifact,
} from '@rust/kcl-lib/bindings/Artifact'
export type { ArtifactId } from '@rust/kcl-lib/bindings/ArtifactId'
export type { BinaryExpression } from '@rust/kcl-lib/bindings/BinaryExpression'
export type { BinaryPart } from '@rust/kcl-lib/bindings/BinaryPart'
export type { CallExpressionKw } from '@rust/kcl-lib/bindings/CallExpressionKw'
export type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
export type { Expr } from '@rust/kcl-lib/bindings/Expr'
export type { ExpressionStatement } from '@rust/kcl-lib/bindings/ExpressionStatement'
export type { Identifier } from '@rust/kcl-lib/bindings/Identifier'
export type { LabeledArg } from '@rust/kcl-lib/bindings/LabeledArg'
export type { Literal } from '@rust/kcl-lib/bindings/Literal'
export type { LiteralValue } from '@rust/kcl-lib/bindings/LiteralValue'
export type { MemberExpression } from '@rust/kcl-lib/bindings/MemberExpression'
export type { Name } from '@rust/kcl-lib/bindings/Name'
export type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
export type { ObjectExpression } from '@rust/kcl-lib/bindings/ObjectExpression'
export type { ObjectProperty } from '@rust/kcl-lib/bindings/ObjectProperty'
export type { Parameter } from '@rust/kcl-lib/bindings/Parameter'
export type { PipeExpression } from '@rust/kcl-lib/bindings/PipeExpression'
export type { PipeSubstitution } from '@rust/kcl-lib/bindings/PipeSubstitution'
export type { Program } from '@rust/kcl-lib/bindings/Program'
export type { ReturnStatement } from '@rust/kcl-lib/bindings/ReturnStatement'
export type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
export type { UnaryExpression } from '@rust/kcl-lib/bindings/UnaryExpression'
export type { VariableDeclaration } from '@rust/kcl-lib/bindings/VariableDeclaration'
export type { VariableDeclarator } from '@rust/kcl-lib/bindings/VariableDeclarator'

export type SyntaxType =
  | 'Program'
  | 'ExpressionStatement'
  | 'BinaryExpression'
  | 'CallExpressionKw'
  | 'Name'
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
  | 'ImportStatement'

export type { ExtrudeSurface } from '@rust/kcl-lib/bindings/ExtrudeSurface'
export type { KclValue } from '@rust/kcl-lib/bindings/KclValue'
export type { Path } from '@rust/kcl-lib/bindings/Path'
export type { Sketch } from '@rust/kcl-lib/bindings/Sketch'
export type { Solid } from '@rust/kcl-lib/bindings/Solid'

function bestSourceRange(error: RustKclError): SourceRange {
  if (error.details.sourceRanges.length === 0) {
    return defaultSourceRange()
  }

  // When there's an error, the call stack is unwound, and the locations are
  // built up from deepest location to shallowest. So the deepest call is first.
  for (const range of error.details.sourceRanges) {
    // Skip ranges pointing into files that aren't the top-level module.
    if (isTopLevelModule(range)) {
      return sourceRangeFromRust(range)
    }
  }
  // We didn't find a top-level module range, so just use the first one.
  return sourceRangeFromRust(error.details.sourceRanges[0])
}

export function defaultNodePath(): NodePath {
  return {
    steps: [],
  }
}

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
      parsed.details.msg,
      bestSourceRange(parsed),
      [],
      [],
      {},
      [],
      defaultArtifactGraph(),
      {},
      null
    )
  }
}

/**
 * Parse and throw an exception if there are any errors (probably not suitable for use outside of testing).
 */
export function assertParse(code: string): Node<Program> {
  const result = parse(code)
  // eslint-disable-next-line suggest-no-throw/suggest-no-throw
  if (err(result)) throw result
  if (!resultIsOk(result)) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error(
      `parse result contains errors: ${result.errors.map((err) => err.message).join('\n')}`,
      { cause: result }
    )
  }
  return result.program
}

export type VariableMap = { [key in string]?: KclValue }

export type PathToNode = [string | number, string][]

export const isPathToNodeNumber = (
  pathToNode: string | number
): pathToNode is number => {
  return typeof pathToNode === 'number'
}

export const isPathToNode = (input: unknown): input is PathToNode =>
  isArray(input) &&
  isArray(input[0]) &&
  input[0].length == 2 &&
  (typeof input[0][0] === 'number' || typeof input[0][0] === 'string') &&
  typeof input[0][1] === 'string'

export interface ExecState {
  variables: { [key in string]?: KclValue }
  operations: Operation[]
  artifactGraph: ArtifactGraph
  errors: CompilationError[]
  filenames: { [x: number]: ModulePath | undefined }
  defaultPlanes: DefaultPlanes | null
}

/**
 * Create an empty ExecState.  This is useful on init to prevent needing an
 * Option.
 */
export function emptyExecState(): ExecState {
  return {
    variables: {},
    operations: [],
    artifactGraph: defaultArtifactGraph(),
    errors: [],
    filenames: [],
    defaultPlanes: null,
  }
}

export function execStateFromRust(execOutcome: RustExecOutcome): ExecState {
  const artifactGraph = artifactGraphFromRust(execOutcome.artifactGraph)

  return {
    variables: execOutcome.variables,
    operations: execOutcome.operations,
    artifactGraph,
    errors: execOutcome.errors,
    filenames: execOutcome.filenames,
    defaultPlanes: execOutcome.defaultPlanes,
  }
}

export type ArtifactGraph = Map<ArtifactId, Artifact>

function artifactGraphFromRust(
  rustArtifactGraph: RustArtifactGraph
): ArtifactGraph {
  const artifactGraph = new Map<ArtifactId, Artifact>()
  // Convert to a Map.
  for (const [id, artifact] of Object.entries(rustArtifactGraph.map)) {
    if (!artifact) continue
    artifactGraph.set(id, artifact)
  }

  // Translate NodePath to PathToNode.
  for (const [_id, artifact] of artifactGraph) {
    if (!artifact) continue
    if (!('codeRef' in artifact)) continue
    const pathToNode = pathToNodeFromRustNodePath(artifact.codeRef.nodePath)
    artifact.codeRef.pathToNode = pathToNode
  }
  return artifactGraph
}

export function sketchFromKclValueOptional(
  obj: KclValue | undefined,
  varName: string | null
): Sketch | Reason {
  if (obj?.type === 'Sketch') return obj.value
  if (obj?.type === 'Solid') return obj.value.sketch
  if (!varName) {
    varName = 'a KCL value'
  }

  const actualType = obj?.type ?? 'unknown'
  return new Reason(
    `Expected ${varName} to be a sketch or solid, but it was ${actualType} instead.`
  )
}

export function sketchFromKclValue(
  obj: KclValue | undefined,
  varName: string | null
): Sketch | Error {
  const result = sketchFromKclValueOptional(obj, varName)
  if (result instanceof Reason) {
    return result.toError()
  }
  return result
}

export const errFromErrWithOutputs = (e: any): KCLError => {
  // `e` is any, so let's figure out something useful to do with it.
  const parsed: KclErrorWithOutputs = (() => {
    // No need to parse, it's already an object.
    if (typeof e === 'object') {
      return e
    }
    // It's a string, so parse it.
    if (typeof e === 'string') {
      return JSON.parse(e)
    }
    // It can be converted to a string, then parsed.
    return JSON.parse(e.toString())
  })()

  return new KCLError(
    parsed.error.kind,
    parsed.error.details.msg,
    bestSourceRange(parsed.error),
    parsed.error.details.backtrace,
    parsed.nonFatal,
    parsed.variables,
    parsed.operations,
    artifactGraphFromRust(parsed.artifactGraph),
    parsed.filenames,
    parsed.defaultPlanes
  )
}

export const kclLint = async (ast: Program): Promise<Array<Discovered>> => {
  try {
    const discoveredFindings: Array<Discovered> = await kcl_lint(
      JSON.stringify(ast)
    )
    return discoveredFindings
  } catch (e: any) {
    return Promise.reject(e)
  }
}

export async function rustImplPathToNode(
  ast: Program,
  range: SourceRange
): Promise<PathToNode> {
  const nodePath = await nodePathFromRange(ast, range)
  if (!nodePath) {
    // When a NodePath can't be found, we use an empty PathToNode.
    return []
  }
  return pathToNodeFromRustNodePath(nodePath)
}

export async function nodePathFromRange(
  ast: Program,
  range: SourceRange
): Promise<NodePath | null> {
  try {
    const nodePath: NodePath | null = await node_path_from_range(
      JSON.stringify(ast),
      JSON.stringify(range)
    )
    return nodePath
  } catch (e: any) {
    return Promise.reject(
      new Error('Caught error getting node path from range', { cause: e })
    )
  }
}

export const recast = (ast: Program): string | Error => {
  return recast_wasm(JSON.stringify(ast))
}

/**
 * Format a number with suffix as KCL.
 */
export function formatNumberLiteral(
  value: number,
  suffix: NumericSuffix
): string | Error {
  try {
    return format_number_literal(value, JSON.stringify(suffix))
  } catch (e) {
    return new Error(
      `Error formatting number literal: value=${value}, suffix=${suffix}`,
      { cause: e }
    )
  }
}

/**
 * Format a number from a KclValue such that it could be parsed as KCL.
 */
export function formatNumberValue(
  value: number,
  numericType: NumericType
): string | Error {
  try {
    return format_number_value(value, JSON.stringify(numericType))
  } catch (e) {
    return new Error(
      `Error formatting number value: value=${value}, numericType=${numericType}`,
      { cause: e }
    )
  }
}

/**
 * Debug display a number with suffix, for human consumption only.
 */
export function humanDisplayNumber(
  value: number,
  ty: NumericType
): string | Error {
  try {
    return human_display_number(value, JSON.stringify(ty))
  } catch (e) {
    return new Error(
      `Error formatting number for human display: value=${value}, ty=${JSON.stringify(ty)}`,
      { cause: e }
    )
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

export function pathToNodeFromRustNodePath(nodePath: NodePath): PathToNode {
  const pathToNode: PathToNode = []
  for (const step of nodePath.steps) {
    switch (step.type) {
      case 'ProgramBodyItem':
        pathToNode.push(['body', ''])
        pathToNode.push([step.index, 'index'])
        break
      case 'CallCallee':
        pathToNode.push(['callee', 'CallExpression'])
        break
      case 'CallArg':
        pathToNode.push(['arguments', 'CallExpression'])
        pathToNode.push([step.index, 'index'])
        break
      case 'CallKwCallee':
        pathToNode.push(['callee', 'CallExpressionKw'])
        break
      case 'CallKwUnlabeledArg':
        pathToNode.push(['unlabeled', UNLABELED_ARG])
        break
      case 'CallKwArg':
        pathToNode.push(['arguments', 'CallExpressionKw'])
        pathToNode.push([step.index, ARG_INDEX_FIELD])
        pathToNode.push(['arg', LABELED_ARG_FIELD])
        break
      case 'BinaryLeft':
        pathToNode.push(['left', 'BinaryExpression'])
        break
      case 'BinaryRight':
        pathToNode.push(['right', 'BinaryExpression'])
        break
      case 'UnaryArg':
        pathToNode.push(['argument', 'UnaryExpression'])
        break
      case 'PipeBodyItem':
        pathToNode.push(['body', 'PipeExpression'])
        pathToNode.push([step.index, 'index'])
        break
      case 'ArrayElement':
        pathToNode.push(['elements', 'ArrayExpression'])
        pathToNode.push([step.index, 'index'])
        break
      case 'ArrayRangeStart':
        pathToNode.push(['startElement', 'ArrayRangeExpression'])
        break
      case 'ArrayRangeEnd':
        pathToNode.push(['endElement', 'ArrayRangeExpression'])
        break
      case 'ObjectProperty':
        pathToNode.push(['properties', 'ObjectExpression'])
        pathToNode.push([step.index, 'index'])
        break
      case 'ObjectPropertyKey':
        pathToNode.push(['key', 'Property'])
        break
      case 'ObjectPropertyValue':
        pathToNode.push(['value', 'Property'])
        break
      case 'ExpressionStatementExpr':
        pathToNode.push(['expression', 'ExpressionStatement'])
        break
      case 'VariableDeclarationDeclaration':
        pathToNode.push(['declaration', 'VariableDeclaration'])
        break
      case 'VariableDeclarationInit':
        pathToNode.push(['init', ''])
        break
      case 'FunctionExpressionParam':
        pathToNode.push(['params', 'FunctionExpression'])
        pathToNode.push([step.index, 'index'])
        break
      case 'FunctionExpressionBody':
        pathToNode.push(['body', 'FunctionExpression'])
        break
      case 'FunctionExpressionBodyItem':
        pathToNode.push(['body', 'FunctionExpression'])
        pathToNode.push([step.index, 'index'])
        break
      case 'ReturnStatementArg':
        pathToNode.push(['argument', 'ReturnStatement'])
        break
      case 'MemberExpressionObject':
        pathToNode.push(['object', 'MemberExpression'])
        break
      case 'MemberExpressionProperty':
        pathToNode.push(['property', 'MemberExpression'])
        break
      case 'IfExpressionCondition':
        pathToNode.push(['cond', 'IfExpression'])
        break
      case 'IfExpressionThen':
        pathToNode.push(['then_val', 'IfExpression'])
        pathToNode.push(['body', 'IfExpression'])
        break
      case 'IfExpressionElseIf':
        pathToNode.push(['else_ifs', 'IfExpression'])
        pathToNode.push([step.index, 'index'])
        break
      case 'IfExpressionElseIfCond':
        pathToNode.push(['cond', 'IfExpression'])
        break
      case 'IfExpressionElseIfBody':
        pathToNode.push(['then_val', 'IfExpression'])
        pathToNode.push(['body', 'IfExpression'])
        break
      case 'IfExpressionElse':
        pathToNode.push(['final_else', 'IfExpression'])
        pathToNode.push(['body', 'IfExpression'])
        break
      case 'ImportStatementItem':
        pathToNode.push(['selector', 'ImportStatement'])
        pathToNode.push(['items', 'ImportSelector'])
        pathToNode.push([step.index, 'index'])
        break
      case 'ImportStatementItemName':
        pathToNode.push(['name', 'ImportItem'])
        break
      case 'ImportStatementItemAlias':
        pathToNode.push(['alias', 'ImportItem'])
        break
      case 'LabeledExpressionExpr':
        pathToNode.push(['expr', 'LabeledExpression'])
        break
      case 'LabeledExpressionLabel':
        pathToNode.push(['label', 'LabeledExpression'])
        break
      case 'AscribedExpressionExpr':
        pathToNode.push(['expr', 'AscribedExpression'])
        break
      case 'SketchBlock':
        // TODO: sketch-api: implement arguments and body.
        break
      case 'SketchVar':
        // TODO: sketch-api: implement initial.
        break
      default:
        const _exhaustiveCheck: never = step
    }
  }
  return pathToNode
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
    console.error('Caught error decoding base64 string', e)
    return new Error('Caught error decoding base64 string', { cause: e })
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
export function changeDefaultUnits(
  kcl: string,
  len: UnitLength | null
): string | Error {
  try {
    return change_default_units(kcl, JSON.stringify(len))
  } catch (e) {
    console.error('Caught error changing kcl settings', e)
    return new Error('Caught error changing kcl settings', { cause: e })
  }
}

/**
 * Change the meta settings for the kcl file.
 * @returns the new kcl string with the updated settings.
 */
export function changeExperimentalFeatures(
  kcl: string,
  warningLevel: string | null = null // TODO: change to WarningLevel | null
): string | Error {
  try {
    return change_experimental_features(kcl, warningLevel ?? '')
  } catch (e) {
    console.error('Caught error changing kcl settings', e)
    return new Error('Caught error changing kcl settings', { cause: e })
  }
}

/**
 * Returns true if the given KCL is empty or only contains settings that would
 * be auto-generated.
 */
export function isKclEmptyOrOnlySettings(kcl: string): boolean {
  if (kcl === '') {
    // Fast path.
    return true
  }

  try {
    return is_kcl_empty_or_only_settings(kcl)
  } catch (e) {
    console.debug('Caught error checking if KCL is empty', e)
    // If there's a parse error, it can't be empty or auto-generated.
    return false
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
export function serializeConfiguration(
  configuration: DeepPartial<Configuration>
): string | Error {
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
  configuration: DeepPartial<ProjectConfiguration>
): string | Error {
  try {
    return serialize_project_configuration(configuration)
  } catch (e: any) {
    return new Error(`Error serializing project configuration: ${e}`)
  }
}
