import { ProgramMemory, Path, SourceRange } from '../executor'
import { Program } from '../abstractSyntaxTree'

export interface InternalFirstArg {
  programMemory: ProgramMemory
  name?: string
  sourceRange: SourceRange
}

export interface PathReturn {
  programMemory: ProgramMemory
  currentPath: Path
}

// export type SketchFn = (internals: InternalFirstArg, ...args: any[]) => PathReturn
// type SketchFn = (internals: InternalFirstArg, ...args: any[]) => PathReturn
export type InternalFn = (internals: InternalFirstArg, ...args: any[]) => any

export interface ModifyAstBase {
  node: Program
  previousProgramMemory: ProgramMemory
  pathToNode: (string | number)[]
}

interface addCall extends ModifyAstBase {
  to: [number, number]
}

interface updateArgs extends ModifyAstBase {
  from: [number, number]
  to: [number, number]
}

export interface SketchLineHelper {
  fn: InternalFn
  add: (a: addCall) => {
    modifiedAst: Program
    pathToNode: (string | number)[]
  }
  updateArgs: (a: updateArgs) => {
    modifiedAst: Program
    pathToNode: (string | number)[]
  }
  addTag: (a: ModifyAstBase) => {
    modifiedAst: Program
    tag: string
  }
}
