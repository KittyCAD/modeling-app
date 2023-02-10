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

interface ModifyAstArgs {
  node: Program
  previousProgramMemory: ProgramMemory
  pathToNode: (string | number)[]
  to: [number, number]
}

interface ModifyAstArgs2 extends ModifyAstArgs {
  from: [number, number]
}

export interface SketchLineHelper {
  fn: InternalFn
  add: (a: ModifyAstArgs) => {
    modifiedAst: Program
    pathToNode: (string | number)[]
  }
  updateArgs: (a: ModifyAstArgs2) => {
    modifiedAst: Program
    pathToNode: (string | number)[]
  }
}
