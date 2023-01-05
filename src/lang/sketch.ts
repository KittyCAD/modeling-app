import { ProgramMemory } from './executor'
import { lineGeo, baseGeo, LineGeos, extrudeGeo } from './engine'
import { BufferGeometry } from 'three'
import { Quaternion, Vector3 } from 'three'

type Coords2d = [number, number]
type SourceRange = [number, number]
type Rotation3 = Quaternion
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
      geo: BufferGeometry
      sourceRange: SourceRange
    }
  | {
      type: 'verticalLineTo'
      name?: string
      y: number
      geo: BufferGeometry
      sourceRange: SourceRange
    }
  | {
      type: 'toPoint'
      name?: string
      to: Coords2d
      geo: LineGeos
      sourceRange: SourceRange
    }
  | {
      type: 'close'
      name?: string
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
  sketch: SketchGeo | ExtrudeGeo | Transform
  sourceRange: SourceRange
}

export interface SketchGeo {
  type: 'sketchGeo'
  sketch: Path[]
  sourceRange: SourceRange
}

export interface ExtrudeFace {
  type: 'extrudeFace'
  quaternion: Quaternion
  translate: [number, number, number]
  geo: BufferGeometry
  sourceRanges: SourceRange[]
}

export interface ExtrudeGeo {
  type: 'extrudeGeo'
  surfaces: ExtrudeFace[]
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
    let from = getCoordsFromPaths(
      programMemory?._sketch,
      programMemory?._sketch.length - 1
    )
    const currentPath: Path = {
      type: 'toPoint',
      to: [x, y],
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
  rx: rotateOnAxis([1, 0, 0]),
  ry: rotateOnAxis([0, 1, 0]),
  rz: rotateOnAxis([0, 0, 1]),
  extrude: (
    programMemory: ProgramMemory,
    name: string = '',
    sourceRange: SourceRange,
    length: number,
    sketchVal: SketchGeo | Transform
  ): ExtrudeGeo | Transform => {
    const getSketchGeo = (sketchVal: SketchGeo | Transform): SketchGeo => {
      if (
        sketchVal.type === 'transform' &&
        sketchVal.sketch.type === 'extrudeGeo'
      )
        throw new Error('Cannot extrude a extrude')
      return sketchVal.type === 'transform'
        ? getSketchGeo(sketchVal.sketch as any) // TODO fix types
        : (sketchVal as SketchGeo) // TODO fix types
    }

    const sketch = getSketchGeo(sketchVal)
    const { position, quaternion } = combineTransforms(sketchVal)

    const extrudeFaces: ExtrudeFace[] = []
    sketch.sketch.map((line, index) => {
      if (line.type === 'toPoint' && index !== 0) {
        const lastPoint = sketch.sketch[index - 1]
        let from: [number, number] = [0, 0]
        if (lastPoint.type === 'toPoint') {
          from = lastPoint.to
        } else if (lastPoint.type === 'base') {
          from = lastPoint.from
        }
        const to = line.to
        const geo = extrudeGeo({
          from: [from[0], from[1], 0],
          to: [to[0], to[1], 0],
          length,
        })
        extrudeFaces.push({
          type: 'extrudeFace',
          quaternion,
          translate: position,
          geo,
          sourceRanges: [line.sourceRange, sourceRange],
        })
      }
    })
    return {
      type: 'extrudeGeo',
      sourceRange,
      surfaces: extrudeFaces,
    }
  },
  translate,
}

function rotateOnAxis(axisMultiplier: [number, number, number]) {
  return (
    programMemory: ProgramMemory,
    sourceRange: SourceRange,
    rotationD: number,
    sketch: SketchGeo | Transform
  ): Transform => {
    const rotationR = rotationD * (Math.PI / 180)
    const rotateVec = new Vector3(...axisMultiplier)
    const quaternion = new Quaternion()
    return {
      type: 'transform',
      rotation: quaternion.setFromAxisAngle(rotateVec, rotationR),
      transform: [0, 0, 0],
      sketch,
      sourceRange,
    }
  }
}

function translate(
  programMemory: ProgramMemory,
  sourceRange: SourceRange,
  vec3: [number, number, number],
  sketch: SketchGeo | Transform
): Transform {
  return {
    type: 'transform',
    rotation: new Quaternion(),
    transform: vec3,
    sketch,
    sourceRange,
  }
}

type PreviousTransforms = {
  rotation: Quaternion
  transform: [number, number, number]
}[]

function collectTransforms(
  sketchVal: SketchGeo | ExtrudeGeo | Transform,
  previousTransforms: PreviousTransforms = []
): PreviousTransforms {
  if (sketchVal.type !== 'transform') return previousTransforms
  const newTransforms = [
    ...previousTransforms,
    {
      rotation: sketchVal.rotation,
      transform: sketchVal.transform,
    },
  ]
  return collectTransforms(sketchVal.sketch, newTransforms)
}

export function combineTransforms(
  sketchVal: SketchGeo | ExtrudeGeo | Transform
): {
  quaternion: Quaternion
  position: [number, number, number]
} {
  const previousTransforms = collectTransforms(sketchVal)
  const position = new Vector3(0, 0, 0)
  const quaternion = new Quaternion()
  previousTransforms.forEach(({ rotation, transform }) => {
    quaternion.multiply(rotation)
    position.applyQuaternion(rotation.clone().invert())
    position.add(new Vector3(...transform))
  })
  return {
    quaternion,
    position: [position.x, position.y, position.z],
  }
}

export function combineTransformsAlt(
  sketchVal: SketchGeo | ExtrudeGeo | Transform
): {
  quaternion: Quaternion
  position: [number, number, number]
} {
  const previousTransforms = collectTransforms(sketchVal)
  let rotationQuaternion = new Quaternion()
  let position = new Vector3(0, 0, 0)
  previousTransforms.reverse().forEach(({ rotation, transform }) => {
    const newQuant = rotation.clone()
    newQuant.multiply(rotationQuaternion)
    rotationQuaternion.copy(newQuant)
    position.applyQuaternion(rotation)
    position.add(new Vector3(...transform))
  })
  return {
    quaternion: rotationQuaternion,
    position: [position.x, position.y, position.z],
  }
}
