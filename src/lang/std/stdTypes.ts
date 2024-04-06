import {
  ProgramMemory,
  Path,
  SourceRange,
  Program,
  Value,
  PathToNode,
  CallExpression,
} from '../wasm'
import { ToolTip } from '../../useStore'
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

export type TransformCallback = (
  args: [Value, Value],
  referencedSegment?: Path
) => {
  callExp: Value
  valueUsedInTransform?: number
}

export type SketchCallTransfromMap = {
  [key in ToolTip]: TransformCallback
}

export interface ConstrainInfo {
  type: LineInputsType | 'vertical' | 'horizontal' | 'tangentialWithPrevious'
  isConstrained: boolean
}

export interface SketchLineHelper {
  add: (a: addCall) => {
    modifiedAst: Program
    pathToNode: PathToNode
    valueUsedInTransform?: number
  }
  updateArgs: (a: updateArgs) => {
    modifiedAst: Program
    pathToNode: PathToNode
  }
  addTag: (a: ModifyAstBase) => {
    modifiedAst: Program
    tag: string
  }
  getConstraintInfo: (callExp: CallExpression) => ConstrainInfo[]
}
