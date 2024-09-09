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
  input: SegmentInputs
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
  value: T
  argIndex: number
}
export interface ArrayItemInput<T> {
  type: 'arrayItem'
  index: 0 | 1
  argType: LineInputsType | 'radius'
  value: T
  argIndex: number
}
export interface ObjectPropertyInput<T> {
  type: 'objectProperty'
  key: VarValueKeys
  argType: LineInputsType | 'radius'
  value: T
  argIndex: number
}

export interface ArrayOrObjItemInput<T> {
  type: 'arrayOrObjItem'
  key: VarValueKeys
  index: 0 | 1
  argType: LineInputsType | 'radius'
  value: T
  argIndex: number
}

export interface ObjectPropertyArrayInput<T> {
  type: 'objectPropertyArray'
  key: VarValueKeys
  argType: LineInputsType | 'radius'
  index: 0 | 1
  value: T
  argIndex: number
}

export type _VarValue<T> =
  | SingleValueInput<T>
  | ArrayItemInput<T>
  | ObjectPropertyInput<T>
  | ArrayOrObjItemInput<T>
  | ObjectPropertyArrayInput<T>

export type VarValue = _VarValue<Expr>
export type RawValue = _VarValue<Literal>

export type VarValues = Array<VarValue>
export type RawValues = Array<RawValue>

export type SimplifiedVarValue =
  | {
      type: 'singleValue'
      argIndex: number
    }
  | { type: 'arrayItem'; index: 0 | 1; argIndex: number }
  | { type: 'objectProperty'; key: VarValueKeys; argIndex: number }
  | {
      type: 'arrayInObject'
      key: VarValueKeys
      index: 0 | 1
    }

export interface SegmentInput {
  varExpression: Expr
  varDetails: VarValue
}

export type TransformCallback = (
  // args: Array<Expr>,
  inputs: SegmentInput[],
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
  argPosition?: SimplifiedVarValue
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
