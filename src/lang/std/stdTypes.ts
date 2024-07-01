import { ToolTip } from 'lang/langHelpers'
import {
  ProgramMemory,
  Path,
  SourceRange,
  Program,
  Value,
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

interface addCall extends ModifyAstBase {
  to: [number, number]
  from: [number, number]
  referencedSegment?: Path
  replaceExisting?: boolean
  createCallback?: TransformCallback // TODO: #29 probably should not be optional
  /// defaults to false, normal behavior  is to add a new callExpression to the end of the pipeExpression
  spliceBetween?: boolean
}

interface updateArgs extends ModifyAstBase {
  from: [number, number]
  to: [number, number]
}

export type VarValueKeys = 'angle' | 'offset' | 'length' | 'to' | 'intersectTag'
export interface SingleValueInput<T> {
  type: 'singleValue'
  argType: LineInputsType
  value: T
}
export interface ArrayItemInput<T> {
  type: 'arrayItem'
  index: 0 | 1
  argType: LineInputsType
  value: T
}
export interface ObjectPropertyInput<T> {
  type: 'objectProperty'
  key: VarValueKeys
  argType: LineInputsType
  value: T
}

export interface ArrayOrObjItemInput<T> {
  type: 'arrayOrObjItem'
  key: VarValueKeys
  index: 0 | 1
  argType: LineInputsType
  value: T
}

export type _VarValue<T> =
  | SingleValueInput<T>
  | ArrayItemInput<T>
  | ObjectPropertyInput<T>
  | ArrayOrObjItemInput<T>

export type VarValue = _VarValue<Value>
export type RawValue = _VarValue<Literal>

export type VarValues = Array<VarValue>
export type RawValues = Array<RawValue>

type SimplifiedVarValue =
  | {
      type: 'singleValue'
    }
  | { type: 'arrayItem'; index: 0 | 1 }
  | { type: 'objectProperty'; key: VarValueKeys }

export type TransformCallback = (
  args: [Value, Value],
  literalValues: RawValues,
  referencedSegment?: Path
) => {
  callExp: Value
  valueUsedInTransform?: number
}

export interface ConstrainInfo {
  stdLibFnName: ToolTip
  type: LineInputsType | 'vertical' | 'horizontal' | 'tangentialWithPrevious'
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
  addTag: (a: ModifyAstBase) =>
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
