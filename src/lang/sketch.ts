import { ProgramMemory } from './executor'
import { lineGeo } from './engine'
import { BufferGeometry } from 'three'

type Coords2d = [number, number]
type SourceRange = [number, number]

export type Path =
  | {
      type: 'points'
      name?: string
      from: Coords2d
      to: Coords2d
      geo: BufferGeometry
      sourceRange: SourceRange
    }
  | {
      type: 'horizontalLineTo'
      name?: string
      x: number
      previousPath: Path
      geo: BufferGeometry
      sourceRange: SourceRange
    }
  | {
      type: 'verticalLineTo'
      name?: string
      y: number
      previousPath: Path
      geo: BufferGeometry
      sourceRange: SourceRange
    }
  | {
      type: 'toPoint'
      name?: string
      to: Coords2d
      previousPath: Path
      geo: BufferGeometry
      sourceRange: SourceRange
    }
  | {
      type: 'close'
      name?: string
      firstPath: Path
      previousPath: Path
      geo: BufferGeometry
      sourceRange: SourceRange
    }
  | {
      type: 'base'
      from: Coords2d
    }

function addBasePath(programMemory: ProgramMemory) {
  const base: Path = {
    type: 'base',
    from: [0, 0],
  }
  if (programMemory._sketch?.length === 0) {
    return {
      ...programMemory,
      _sketch: [base],
    }
  }
  return programMemory
}

interface PathReturn {
  programMemory: ProgramMemory
  currentPath: Path
}

function getCoordsFromPaths(paths: Path[], index = 0): Coords2d {
  const currentPath = paths[index]
  if (!currentPath) {
    return [0, 0]
  }
  if (currentPath.type === 'points' || currentPath.type === 'toPoint') {
    return currentPath.to
  } else if (currentPath.type === 'base') {
    return currentPath.from
  } else if (currentPath.type === 'horizontalLineTo') {
    const pathBefore = getCoordsFromPaths(paths, index - 1)
    return [currentPath.x, pathBefore[1]]
  } else if (currentPath.type === 'verticalLineTo') {
    const pathBefore = getCoordsFromPaths(paths, index - 1)
    return [pathBefore[0], currentPath.y]
  }
  return [0, 0]
}

export const sketchFns = {
  close: (
    programMemory: ProgramMemory,
    name: string = '',
    sourceRange: SourceRange
  ): PathReturn => {
    const lastPath = programMemory?._sketch?.[
      programMemory?._sketch.length - 1
    ] as Path

    let from = getCoordsFromPaths(
      programMemory?._sketch,
      programMemory?._sketch.length - 1
    )
    const firstPath = programMemory?._sketch?.[0] as Path
    if (lastPath?.type === 'base') {
      throw new Error('Cannot close a base path')
    }
    let to = getCoordsFromPaths(programMemory?._sketch, 0)

    const newPath: Path = {
      type: 'close',
      firstPath,
      previousPath: lastPath,
      geo: lineGeo({ from: [...from, 0], to: [...to, 0] }),
      sourceRange,
    }
    if (name) {
      newPath.name = name
    }
    return {
      programMemory: {
        ...programMemory,
        _sketch: [...(programMemory?._sketch || []), newPath],
      },
      currentPath: newPath,
    }
  },
  lineTo: (
    programMemory: ProgramMemory,
    name: string = '',
    sourceRange: SourceRange,
    ...args: any[]
  ): PathReturn => {
    const _programMemory = addBasePath(programMemory)
    const [x, y] = args
    if (!_programMemory._sketch) {
      throw new Error('No sketch to draw on')
    }
    const lastPath: Path =
      _programMemory._sketch[_programMemory._sketch.length - 1]
    let from = getCoordsFromPaths(
      programMemory?._sketch,
      programMemory?._sketch.length - 1
    )
    const currentPath: Path = {
      type: 'toPoint',
      to: [x, y],
      previousPath: lastPath,
      geo: lineGeo({ from: [...from, 0], to: [x, y, 0] }),
      sourceRange,
    }
    if (name) {
      currentPath.name = name
    }
    return {
      programMemory: {
        ..._programMemory,
        _sketch: [...(_programMemory._sketch || []), currentPath],
      },
      currentPath,
    }
  },
}
