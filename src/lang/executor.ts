import { Program } from './abstractSyntaxTreeTypes'
import {
  EngineCommandManager,
  ArtifactMap,
  SourceRangeMap,
} from './std/engineConnection'
import { ProgramReturn } from '../wasm-lib/bindings/ProgramReturn'
import { execute_wasm } from '../wasm-lib/pkg/wasm_lib'
import { KCLError } from './errors'
import { KclError as RustKclError } from '../wasm-lib/bindings/KclError'
import { rangeTypeFix } from './abstractSyntaxTree'

export type SourceRange = [number, number]
export type PathToNode = [string | number, string][] // [pathKey, nodeType][]
export type Metadata = {
  sourceRange: SourceRange
}
export type Position = [number, number, number]
export type Rotation = [number, number, number, number]

interface BasePath {
  from: [number, number]
  to: [number, number]
  name?: string
  __geoMeta: {
    id: string
    sourceRange: SourceRange
  }
}

export interface ToPoint extends BasePath {
  type: 'toPoint'
}

export interface Base extends BasePath {
  type: 'base'
}

export interface HorizontalLineTo extends BasePath {
  type: 'horizontalLineTo'
  x: number
}

export interface AngledLineTo extends BasePath {
  type: 'angledLineTo'
  angle: number
  x?: number
  y?: number
}

interface GeoMeta {
  __geoMeta: {
    id: string
    sourceRange: SourceRange
  }
}

export type Path = ToPoint | HorizontalLineTo | AngledLineTo | Base

export interface SketchGroup {
  type: 'sketchGroup'
  id: string
  value: Path[]
  start?: Base
  position: Position
  rotation: Rotation
  __meta: Metadata[]
}

interface ExtrudePlane {
  type: 'extrudePlane'
  position: Position
  rotation: Rotation
  name?: string
}

export type ExtrudeSurface = GeoMeta &
  ExtrudePlane /* | ExtrudeRadius | ExtrudeSpline */

export interface ExtrudeGroup {
  type: 'extrudeGroup'
  id: string
  value: ExtrudeSurface[]
  height: number
  position: Position
  rotation: Rotation
  __meta: Metadata[]
}

/** UserVal not produced by one of our internal functions */
export interface UserVal {
  type: 'userVal'
  value: any
  __meta: Metadata[]
}

type MemoryItem = UserVal | SketchGroup | ExtrudeGroup

interface Memory {
  [key: string]: MemoryItem
}

export interface ProgramMemory {
  root: Memory
  return?: ProgramReturn
}

export const executor = async (
  node: Program,
  programMemory: ProgramMemory = { root: {} },
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
  programMemory: ProgramMemory = { root: {} },
  engineCommandManager: EngineCommandManager
): Promise<ProgramMemory> => {
  try {
    const memory: ProgramMemory = await execute_wasm(
      JSON.stringify(node),
      JSON.stringify(programMemory)
    )
    return memory
  } catch (e: any) {
    const parsed: RustKclError = JSON.parse(e.toString())
    const kclError = new KCLError(
      parsed.kind,
      parsed.kind === 'invalid_expression' ? parsed.kind : parsed.msg,
      parsed.kind === 'invalid_expression'
        ? [[parsed.start, parsed.end]]
        : rangeTypeFix(parsed.sourceRanges)
    )

    console.log(kclError)
    throw kclError
  }
}
