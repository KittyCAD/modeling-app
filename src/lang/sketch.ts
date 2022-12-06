import { ProgramMemory } from './executor'
import { lineGeo, baseGeo, LineGeos } from './engine'
import { BufferGeometry } from 'three'

type Coords2d = [number, number]
type SourceRange = [number, number]
type Rotation3 = [number, number, number]
type Translate3 = [number, number, number]

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
      geo: LineGeos
      sourceRange: SourceRange
    }
  | {
      type: 'close'
      name?: string
      firstPath: Path
      previousPath: Path
      geo: LineGeos
      sourceRange: SourceRange
    }
  | {
      type: 'base'
      from: Coords2d
      geo: BufferGeometry
      sourceRange: SourceRange
    }

export interface Transform {
  type: 'transform'
  rotation: Rotation3
  transform: Translate3
  sketch: SketchGeo | Transform
  sourceRange: SourceRange
}

export interface SketchGeo {
  type: 'sketchGeo'
  sketch: Path[]
  sourceRange: SourceRange
}

function addBasePath(programMemory: ProgramMemory) {
  const geo = baseGeo({ from: [0, 0, 0] })
  const base: Path = {
    type: 'base',
    from: [0, 0],
    sourceRange: [0, 0],
    geo,
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
  base: (
    programMemory: ProgramMemory,
    name: string = '',
    sourceRange: SourceRange,
    ...args: any[]
  ): PathReturn => {
    if (programMemory._sketch?.length > 0) {
      throw new Error('Base can only be called once')
    }
    const [x, y] = args as [number, number]
    let from: [number, number] = [x, y]
    const geo = baseGeo({ from: [x, y, 0] })
    const newPath: Path = {
      type: 'base',
      from,
      sourceRange,
      geo,
    }
    return {
      programMemory: {
        ...programMemory,
        _sketch: [...(programMemory?._sketch || []), newPath],
      },
      currentPath: newPath,
    }
  },
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
  rx: RotateOnAxis([1, 0, 0]),
  ry: RotateOnAxis([0, 1, 0]),
  rz: RotateOnAxis([0, 0, 1]),
}

function RotateOnAxis(axisMultiplier: [number, number, number]) {
  return (
    programMemory: ProgramMemory,
    sourceRange: SourceRange,
    rotationD: number,
    sketch: SketchGeo | Transform
  ): Transform => {
    const rotationR = rotationD * (Math.PI / 180)
    return {
      type: 'transform',
      rotation: axisMultiplier.map((axis) => axis * rotationR) as Rotation3,
      transform: [0, 0, 0],
      sketch,
      sourceRange,
    }
  }
}
