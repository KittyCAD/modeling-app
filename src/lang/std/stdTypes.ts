import { ToolTip } from 'lang/langHelpers'
import {
  Path,
  SourceRange,
  Program,
  Expr,
  PathToNode,
  CallExpression,
  Literal,
  BinaryPart,
  CallExpressionKw,
  VariableMap,
} from '../wasm'
import { LineInputsType } from './sketchcombos'
import { Node } from '@rust/kcl-lib/bindings/Node'

export interface ModifyAstBase {
  node: Node<Program>
  // TODO #896: Remove memory variables from this interface
  variables: VariableMap
  pathToNode: PathToNode
}

export interface AddTagInfo {
  node: Node<Program>
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
  to: [number, number]
  center: [number, number]
  radius: number
  ccw: boolean
}
/** Inputs for three point circle */
interface CircleThreePointSegmentInput {
  type: 'circle-three-point-segment'
  p1: [number, number]
  p2: [number, number]
  p3: [number, number]
}

/**
 * SegmentInputs is a union type that can be either a StraightSegmentInput or an ArcSegmentInput.
 *
 * - StraightSegmentInput: Represents a straight segment with a starting point (from) and an ending point (to).
 * - ArcSegmentInput: Represents an arc segment with a starting point (from), a center point, and a radius.
 */
export type SegmentInputs =
  | StraightSegmentInput
  | ArcSegmentInput
  | CircleThreePointSegmentInput

/**
 * Interface for adding or replacing a sketch stblib call expression to a sketch.
 * Replacing normally means adding or removing a constraint
 *
 * @property segmentInput - The input segment data, which can be either a straight segment or an arc segment.
 * @property replaceExistingCallback - An optional callback function to replace an existing call expression,
 * if not provided, a new call expression will be added using segMentInput values.
 * @property referencedSegment - An optional path to a referenced segment.
 * @property spliceBetween=false - Defaults to false. Normal behavior is to add a new callExpression to the end of the pipeExpression.
 */
export interface addCall extends ModifyAstBase {
  segmentInput: SegmentInputs
  replaceExistingCallback?: (
    rawArgs: RawArgs
  ) => CreatedSketchExprResult | Error
  referencedSegment?: Path
  spliceBetween?: boolean
}

interface updateArgs extends ModifyAstBase {
  input: SegmentInputs
}

export type InputArgKeys =
  | 'angle'
  | 'offset'
  | 'length'
  | 'to'
  | 'intersectTag'
  | 'radius'
  | 'center'
  | 'p1'
  | 'p2'
  | 'p3'
export interface SingleValueInput<T> {
  type: 'singleValue'
  argType: LineInputsType
  expr: T
}
export interface ArrayItemInput<T> {
  type: 'arrayItem'
  index: 0 | 1
  argType: LineInputsType
  expr: T
}
export interface ObjectPropertyInput<T> {
  type: 'objectProperty'
  key: InputArgKeys
  argType: LineInputsType
  expr: T
}

interface ArrayOrObjItemInput<T> {
  type: 'arrayOrObjItem'
  key: InputArgKeys
  index: 0 | 1
  argType: LineInputsType
  expr: T
}

interface ArrayInObject<T> {
  type: 'arrayInObject'
  key: InputArgKeys
  argType: LineInputsType
  index: 0 | 1
  expr: T
}

type _InputArg<T> =
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
export type InputArg = _InputArg<Node<Expr>>

/**
 * {@link RawArg.expr} is the literal equivalent of whatever current expression is
 * i.e. if the expression is 5 + 6, the literal would be 11
 * but of course works for expressions like myVar + someFn() etc too
 * This is useful in cases where we want to "un-constrain" inputs to segments
 */
type RawArg = _InputArg<Node<Literal>>

export type InputArgs = Array<InputArg>

/**
 * The literal equivalent of whatever current expression is
 * i.e. if the expression is 5 + 6, the literal would be 11
 * but of course works for expressions like myVar + someFn() etc too
 * This is useful in cases where we want to "un-constrain" inputs to segments
 */
export type RawArgs = Array<RawArg>

/**
 * Serves the same role as {@link InputArg} on {@link RawArg}
 * but without the {@link RawArg.expr} property, since it is not needed
 * when we only need to know where there arg is.
 */
export type SimplifiedArgDetails =
  | Omit<SingleValueInput<null>, 'expr' | 'argType'>
  | Omit<ArrayItemInput<null>, 'expr' | 'argType'>
  | Omit<ObjectPropertyInput<null>, 'expr' | 'argType'>
  | Omit<ArrayOrObjItemInput<null>, 'expr' | 'argType'>
  | Omit<ArrayInObject<null>, 'expr' | 'argType'>

/**
 * Represents the result of creating a sketch expression (line, tangentialArcTo, angledLine, circle, etc.).
 *
 * @property {Expr} callExp - This is the main result; recasting the expression should give the user the new function call.
 * @property {number} [valueUsedInTransform] - Aside from `callExp`, we also return the number used in the transform, which is useful for constraints.
 * For example, when adding a "horizontal distance" constraint, we don't want the segments to move, just constrain them in place.
 * So the second segment will probably be something like `line(endAbsolute = [segEndX($firstSegTag) + someLiteral, 123])` where `someLiteral` is
 * the value of the current horizontal distance, That is we calculate the value needed to constrain the second segment without it moving.
 * We can run the ast-mod to get this constraint `valueUsedInTransform` without applying the mod so that we can surface this to the user in a modal.
 * We show them the modal where they can specify the distance they want to constrain to.
 * We pre-fill this with the current value `valueUsedInTransform`, which they can accept or change, and we'll use that to apply the final ast-mod.
 */
export interface CreatedSketchExprResult {
  callExp: Expr
  valueUsedInTransform?: number
}

export type CreateStdLibSketchCallExpr = (args: {
  inputs: InputArgs
  rawArgs: RawArgs
  referenceSegName: string
  tag?: Node<Expr>
  forceValueUsedInTransform?: BinaryPart
  referencedSegment?: Path
}) => CreatedSketchExprResult | Error

export type TransformInfo = {
  tooltip: ToolTip
  createNode: CreateStdLibSketchCallExpr
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
        modifiedAst: Node<Program>
        pathToNode: PathToNode
        valueUsedInTransform?: number
      }
    | Error
  updateArgs: (a: updateArgs) =>
    | {
        modifiedAst: Node<Program>
        pathToNode: PathToNode
      }
    | Error
  getTag: (a: CallExpression) => string | Error
  addTag: (a: AddTagInfo) =>
    | {
        modifiedAst: Node<Program>
        tag: string
      }
    | Error
  getConstraintInfo: (
    callExp: Node<CallExpression>,
    code: string,
    pathToNode: PathToNode,
    filterValue?: string
  ) => ConstrainInfo[]
}

export interface SketchLineHelperKw {
  add: (a: addCall) =>
    | {
        modifiedAst: Node<Program>
        pathToNode: PathToNode
        valueUsedInTransform?: number
      }
    | Error
  updateArgs: (a: updateArgs) =>
    | {
        modifiedAst: Node<Program>
        pathToNode: PathToNode
      }
    | Error
  getTag: (a: CallExpressionKw) => string | Error
  addTag: (a: AddTagInfo) =>
    | {
        modifiedAst: Node<Program>
        tag: string
      }
    | Error
  getConstraintInfo: (
    callExp: Node<CallExpressionKw>,
    code: string,
    pathToNode: PathToNode,
    filterValue?: string
  ) => ConstrainInfo[]
}
