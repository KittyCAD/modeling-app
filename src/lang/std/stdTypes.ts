import { ToolTip } from 'lang/langHelpers'
import {
  ProgramMemory,
  Path,
  SourceRange,
  Program,
  Expr,
  PathToNode,
  CallExpression,
  Literal,
} from '../wasm'
import { EngineCommandManager } from './engineConnection'
import { LineInputsType } from './sketchcombos'

export interface InternalFirstArg {
  programMemory: ProgramMemory
  name?: string
  sourceRange: SourceRange
  engineCommandManager: EngineCommandManager
  code: string
}

export interface PathReturn {
  programMemory: ProgramMemory
  currentPath: Path
}

export interface ModifyAstBase {
  node: Program
  // TODO #896: Remove ProgramMemory from this interface
  previousProgramMemory: ProgramMemory
  pathToNode: PathToNode
}

export interface AddTagInfo {
  node: Program
  pathToNode: PathToNode
}

/** Inputs for all straight segments, to and from are absolute values, as this gives a
 * consistent base that can be converted to all of the line, angledLine, etc segment types
 * One notable exception to "straight segment" is that tangentialArcTo is included in this
 * Input type since it too only takes x-y values and is able to get extra info it needs
 * to be tangential from the previous segment */
interface StraightSegmentInput {
  type: 'straight-segment'
  from: [number, number]
  to: [number, number]
}

/** Inputs for arcs, excluding tangentialArcTo for reasons explain in
 * the @straightSegmentInput comment */
interface ArcSegmentInput {
  type: 'arc-segment'
  from: [number, number]
  center: [number, number]
  radius: number
}

/**
 * SegmentInputs is a union type that can be either a StraightSegmentInput or an ArcSegmentInput.
 *
 * - StraightSegmentInput: Represents a straight segment with a starting point (from) and an ending point (to).
 * - ArcSegmentInput: Represents an arc segment with a starting point (from), a center point, and a radius.
 */
export type SegmentInputs = StraightSegmentInput | ArcSegmentInput

interface addCall extends ModifyAstBase {
  segmentInput: SegmentInputs
  referencedSegment?: Path
  replaceExisting?: boolean
  createCallback?: TransformCallback // TODO: #29 probably should not be optional
  /// defaults to false, normal behavior  is to add a new callExpression to the end of the pipeExpression
  spliceBetween?: boolean
}

interface updateArgs extends ModifyAstBase {
  input: SegmentInputs
}

export type VarValueKeys =
  | 'angle'
  | 'offset'
  | 'length'
  | 'to'
  | 'intersectTag'
  | 'radius'
  | 'center'
export interface SingleValueInput<T> {
  type: 'singleValue'
  argType: LineInputsType | 'radius'
  expr: T
}
export interface ArrayItemInput<T> {
  type: 'arrayItem'
  index: 0 | 1
  argType: LineInputsType | 'radius'
  expr: T
}
export interface ObjectPropertyInput<T> {
  type: 'objectProperty'
  key: VarValueKeys
  argType: LineInputsType | 'radius'
  expr: T
}

interface ArrayOrObjItemInput<T> {
  type: 'arrayOrObjItem'
  key: VarValueKeys
  index: 0 | 1
  argType: LineInputsType | 'radius'
  expr: T
}

interface ArrayInObject<T> {
  type: 'arrayInObject'
  key: VarValueKeys
  argType: LineInputsType | 'radius'
  index: 0 | 1
  expr: T
}

type _VarValue<T> =
  | SingleValueInput<T>
  | ArrayItemInput<T>
  | ObjectPropertyInput<T>
  | ArrayOrObjItemInput<T>
  | ArrayInObject<T>

/**
 * {@link RawArg.expr} is the current expression for each of the args for a segment
 * i.e. if the expression is 5 + 6, {@link RawArg.expr} will be that binary expression
 *
 * Other properties on this type describe how the args are defined for this particular segment
 * i.e. line uses [x, y] style inputs, while angledLine uses either [angle, length] or {angle, length}
 * and circle uses {center: [x, y], radius: number}
 * Which is why a union type is used that can be type narrowed using the {@link RawArg.type} property
 * {@link RawArg.expr} is common to all of these types
 */
export type InputArg = _VarValue<Expr>

/**
 * {@link RawArg.expr} is the literal equivalent of whatever current expression is
 * i.e. if the expression is 5 + 6, the literal would be 11
 * but of course works for expressions like myVar + someFn() etc too
 * This is useful in cases where we want to "un-constrain" inputs to segments
 */
type RawArg = _VarValue<Literal>

export type InputArgs = Array<InputArg>

// /**
//  * The literal equivalent of whatever current expression is
//  * i.e. if the expression is 5 + 6, the literal would be 11
//  * but of course works for expressions like myVar + someFn() etc too
//  * This is useful in cases where we want to "un-constrain" inputs to segments
//  */
type RawArgs = Array<RawArg>

/**
 * Serves the same role as {@link InputArg} on {@link RawArg}
 * but without the {@link RawArg.expr} property, since it is not needed
 * when we only need to know where there arg is.
 */
export type SimplifiedArgDetails =
  | {
      type: 'singleValue'
    }
  | { type: 'arrayItem'; index: 0 | 1 }
  | { type: 'objectProperty'; key: VarValueKeys }
  | {
      type: 'arrayInObject'
      key: VarValueKeys
      index: 0 | 1
    }

export type TransformCallback = (
  inputs: InputArgs,
  referencedSegment?: Path
) => {
  callExp: Expr
  valueUsedInTransform?: number
}

export interface ConstrainInfo {
  stdLibFnName: ToolTip
  type:
    | LineInputsType
    | 'vertical'
    | 'horizontal'
    | 'tangentialWithPrevious'
    | 'radius'
  isConstrained: boolean
  sourceRange: SourceRange
  pathToNode: PathToNode
  value: string
  calculatedValue?: any
  argPosition?: SimplifiedArgDetails
}

export interface SketchLineHelper {
  add: (a: addCall) =>
    | {
        modifiedAst: Program
        pathToNode: PathToNode
        valueUsedInTransform?: number
      }
    | Error
  updateArgs: (a: updateArgs) =>
    | {
        modifiedAst: Program
        pathToNode: PathToNode
      }
    | Error
  getTag: (a: CallExpression) => string | Error
  addTag: (a: AddTagInfo) =>
    | {
        modifiedAst: Program
        tag: string
      }
    | Error
  getConstraintInfo: (
    callExp: CallExpression,
    code: string,
    pathToNode: PathToNode
  ) => ConstrainInfo[]
}
