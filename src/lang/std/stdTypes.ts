import {
  ProgramMemory,
  Path,
  SourceRange,
  Program,
  Value,
  PathToNode,
} from '../wasm'
import { ToolTip } from '../../useStore'
import { EngineCommandManager } from './engineConnection'

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
  [key in ToolTip]: TransformCallback
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
}
