import { ProgramMemory, Path, SourceRange } from '../executor'
import { Program, Value } from '../abstractSyntaxTree'
import { TooTip } from '../../useStore'
import { PathToNode } from '../executor'
import { EngineCommandManager } from './engineConnection'

export interface InternalFirstArg {
  programMemory: ProgramMemory
  name?: string
  sourceRange: SourceRange
  engineCommandManager: EngineCommandManager
}

export interface PathReturn {
  programMemory: ProgramMemory
  currentPath: Path
}

export type InternalFn = (internals: InternalFirstArg, ...args: any[]) => any

export type InternalFnNames =
  | 'extrude'
  | 'translate'
  | 'transform'
  | 'getExtrudeWallTransform'
  | 'min'
  | 'legLen'
  | 'legAngX'
  | 'legAngY'
  | 'segEndX'
  | 'segEndY'
  | 'lastSegX'
  | 'lastSegY'
  | 'segLen'
  | 'segAng'
  | 'angleToMatchLengthX'
  | 'angleToMatchLengthY'
  | 'rx'
  | 'ry'
  | 'rz'
  | 'lineTo'
  | 'yLineTo'
  | 'xLineTo'
  | 'line'
  | 'yLine'
  | 'xLine'
  | 'angledLine'
  | 'angledLineOfXLength'
  | 'angledLineToX'
  | 'angledLineOfYLength'
  | 'angledLineToY'
  | 'startSketchAt'
  | 'close'
  | 'angledLineThatIntersects'

export interface ModifyAstBase {
  node: Program
  previousProgramMemory: ProgramMemory
  pathToNode: PathToNode
}

interface addCall extends ModifyAstBase {
  to: [number, number]
  from: [number, number]
  referencedSegment?: Path
  replaceExisting?: boolean
  createCallback?: TransformCallback // TODO: #29 probably should not be optional
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
  [key in TooTip]: TransformCallback
}

export interface SketchLineHelper {
  fn: InternalFn
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
}
