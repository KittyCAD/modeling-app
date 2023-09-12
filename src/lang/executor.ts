import { Program } from './abstractSyntaxTreeTypes'
import {
  EngineCommandManager,
  ArtifactMap,
  SourceRangeMap,
} from './std/engineConnection'
//import { ProgramMemory } from '../wasm-lib/kcl/bindings/ProgramMemory'
import { ProgramReturn } from '../wasm-lib/kcl/bindings/ProgramReturn'
import { MemoryItem } from '../wasm-lib/kcl/bindings/MemoryItem'
import { execute_wasm } from '../wasm-lib/pkg/wasm_lib'
import { KCLError } from './errors'
import { KclError as RustKclError } from '../wasm-lib/kcl/bindings/KclError'
import { rangeTypeFix } from './abstractSyntaxTree'

//export type { ProgramMemory } from '../wasm-lib/kcl/bindings/ProgramMemory'
export type { SourceRange } from '../wasm-lib/kcl/bindings/SourceRange'
export type { Position } from '../wasm-lib/kcl/bindings/Position'
export type { Rotation } from '../wasm-lib/kcl/bindings/Rotation'
export type { Path } from '../wasm-lib/kcl/bindings/Path'
export type { SketchGroup } from '../wasm-lib/kcl/bindings/SketchGroup'
export type { MemoryItem } from '../wasm-lib/kcl/bindings/MemoryItem'
export type { ExtrudeSurface } from '../wasm-lib/kcl/bindings/ExtrudeSurface'

export type PathToNode = [string | number, string][]

interface Memory {
  [key: string]: MemoryItem
}

export interface ProgramMemory {
  root: Memory
  return: ProgramReturn | null
}

export const executor = async (
  node: Program,
  programMemory: ProgramMemory = { root: {}, return: null },
  engineCommandManager: EngineCommandManager,
  // work around while the gemotry is still be stored on the frontend
  // will be removed when the stream UI is added.
  tempMapCallback: (a: {
    artifactMap: ArtifactMap
    sourceRangeMap: SourceRangeMap
  }) => void = () => {}
): Promise<ProgramMemory> => {
  engineCommandManager.startNewSession()
  const _programMemory = await _executor(
    node,
    programMemory,
    engineCommandManager
  )
  const { artifactMap, sourceRangeMap } =
    await engineCommandManager.waitForAllCommands()
  tempMapCallback({ artifactMap, sourceRangeMap })

  engineCommandManager.endSession()
  return _programMemory
}

export const _executor = async (
  node: Program,
  programMemory: ProgramMemory = { root: {}, return: null },
  engineCommandManager: EngineCommandManager
): Promise<ProgramMemory> => {
  try {
    const memory: ProgramMemory = await execute_wasm(
      JSON.stringify(node),
      JSON.stringify(programMemory),
      engineCommandManager
    )
    return memory
  } catch (e: any) {
    const parsed: RustKclError = JSON.parse(e.toString())
    const kclError = new KCLError(
      parsed.kind,
      parsed.msg,
      rangeTypeFix(parsed.sourceRanges)
    )

    console.log(kclError)
    throw kclError
  }
}
