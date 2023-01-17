import {
  ProgramMemory,
  Path,
  SketchGroup,
  ExtrudeGroup,
  SourceRange,
  ExtrudeSurface,
  Position,
  Rotation,
} from './executor'
import { lineGeo, extrudeGeo } from './engine'
import { Quaternion, Vector3 } from 'three'

type Coords2d = [number, number]

interface PathReturn {
  programMemory: ProgramMemory
  currentPath: Path
}

function getCoordsFromPaths(paths: Path[], index = 0): Coords2d {
  const currentPath = paths[index]
  if (!currentPath) {
    return [0, 0]
  }
  if (currentPath.type === 'horizontalLineTo') {
    const pathBefore = getCoordsFromPaths(paths, index - 1)
    return [currentPath.x, pathBefore[1]]
  } else if (currentPath.type === 'toPoint') {
    return [currentPath.to[0], currentPath.to[1]]
  }
  return [0, 0]
}

interface InternalFirstArg {
  programMemory: ProgramMemory
  name?: string
  sourceRange: SourceRange
}

type SketchFn = (internals: InternalFirstArg, ...args: any[]) => PathReturn

export type SketchFnNames = 'close' | 'lineTo'

type InternalFn = (internals: InternalFirstArg, ...args: any[]) => any

export type InternalFnNames =
  | 'extrude'
  | 'translate'
  | 'transform'
  | 'getExtrudeWallTransform'
  | 'rx'
  | 'ry'
  | 'rz'

export const sketchFns: { [key in SketchFnNames]: SketchFn } = {
  close: ({ programMemory, name = '', sourceRange }) => {
    const firstPath = programMemory?._sketch?.[0] as Path

    let from = getCoordsFromPaths(
      programMemory?._sketch || [],
      (programMemory?._sketch?.length || 1) - 1
    )

    let to = getCoordsFromPaths(programMemory?._sketch || [], 0)
    const geo = lineGeo({ from: [...from, 0], to: [...to, 0] })
    const newPath: Path = {
      type: 'toPoint',
      from,
      to,
      __geoMeta: {
        sourceRange,
        pathToNode: [], // TODO
        geos: [
          {
            type: 'line',
            geo: geo.line,
          },
          {
            type: 'lineEnd',
            geo: geo.tip,
          },
        ],
      },
    }
    if (name) {
      newPath.name = name
    }
    return {
      programMemory: {
        ...programMemory,
        _sketch: [
          {
            ...firstPath,
            from,
          },
          ...(programMemory?._sketch || []).slice(1),
          newPath,
        ],
      },
      currentPath: newPath,
    }
  },
  lineTo: ({ programMemory, name = '', sourceRange }, ...args) => {
    const [x, y] = args
    if (!programMemory._sketch) {
      throw new Error('No sketch to draw on')
    }
    let from = getCoordsFromPaths(
      programMemory?._sketch || [],
      (programMemory?._sketch?.length || 1) - 1
    )
    const geo = lineGeo({ from: [...from, 0], to: [x, y, 0] })
    const currentPath: Path = {
      type: 'toPoint',
      to: [x, y],
      from,
      __geoMeta: {
        sourceRange,
        pathToNode: [], // TODO
        geos: [
          {
            type: 'line',
            geo: geo.line,
          },
          {
            type: 'lineEnd',
            geo: geo.tip,
          },
        ],
      },
    }
    if (name) {
      currentPath.name = name
    }
    return {
      programMemory: {
        ...programMemory,
        _sketch: [...(programMemory._sketch || []), currentPath],
      },
      currentPath,
    }
  },
}

function rotateOnAxis<T extends SketchGroup | ExtrudeGroup>(
  axisMultiplier: [number, number, number]
): InternalFn {
  return ({ sourceRange }, rotationD: number, sketch: T): T => {
    const rotationR = rotationD * (Math.PI / 180)
    const rotateVec = new Vector3(...axisMultiplier)
    const quaternion = new Quaternion()
    quaternion.setFromAxisAngle(rotateVec, rotationR)

    const position = new Vector3(...sketch.position)
      .applyQuaternion(quaternion)
      .toArray()

    const existingQuat = new Quaternion(...sketch.rotation)
    const rotation = quaternion.multiply(existingQuat).toArray()
    return {
      ...sketch,
      rotation,
      position,
      __meta: [
        ...sketch.__meta,
        {
          sourceRange,
          pathToNode: [], // TODO
        },
      ],
    }
  }
}

const extrude: InternalFn = (
  { sourceRange },
  length: number,
  sketchVal: SketchGroup
): ExtrudeGroup => {
  const getSketchGeo = (sketchVal: SketchGroup): SketchGroup => {
    return sketchVal
  }

  const sketch = getSketchGeo(sketchVal)
  const { position, rotation } = sketchVal

  const extrudeSurfaces: ExtrudeSurface[] = []
  const extrusionDirection = clockwiseSign(sketch.value.map((line) => line.to))
  sketch.value.map((line, index) => {
    if (line.type === 'toPoint') {
      let from: [number, number] = line.from
      const to = line.to
      const {
        geo,
        position: facePosition,
        rotation: faceRotation,
      } = extrudeGeo({
        from: [from[0], from[1], 0],
        to: [to[0], to[1], 0],
        length,
        extrusionDirection,
      })
      const groupQuaternion = new Quaternion(...rotation)
      const currentWallQuat = new Quaternion(...faceRotation)
      const unifiedQuit = new Quaternion().multiplyQuaternions(
        currentWallQuat,
        groupQuaternion.clone().invert()
      )

      const facePositionVector = new Vector3(...facePosition)
      facePositionVector.applyQuaternion(groupQuaternion.clone())
      const unifiedPosition = new Vector3().addVectors(
        facePositionVector,
        new Vector3(...position)
      )
      const surface: ExtrudeSurface = {
        type: 'extrudePlane',
        position: unifiedPosition.toArray() as Position,
        rotation: unifiedQuit.toArray() as Rotation,
        __geoMeta: {
          geo,
          sourceRange: line.__geoMeta.sourceRange,
          pathToNode: line.__geoMeta.pathToNode,
        },
      }
      line.name && (surface.name = line.name)
      extrudeSurfaces.push(surface)
    }
  })
  return {
    type: 'extrudeGroup',
    value: extrudeSurfaces,
    height: length,
    position,
    rotation,
    __meta: [
      {
        sourceRange,
        pathToNode: [], // TODO
      },
      {
        sourceRange: sketchVal.__meta[0].sourceRange,
        pathToNode: sketchVal.__meta[0].pathToNode,
      },
    ],
  }
}

const translate: InternalFn = <T extends SketchGroup | ExtrudeGroup>(
  { sourceRange }: InternalFirstArg,
  vec3: [number, number, number],
  sketch: T
): T => {
  const oldPosition = new Vector3(...sketch.position)
  const newPosition = oldPosition.add(new Vector3(...vec3))
  return {
    ...sketch,
    position: newPosition.toArray(),
    __meta: [
      ...sketch.__meta,
      {
        sourceRange,
        pathToNode: [], // TODO
      },
    ],
  }
}

const transform: InternalFn = <T extends SketchGroup | ExtrudeGroup>(
  { sourceRange }: InternalFirstArg,
  transformInfo: {
    position: Position
    quaternion: Rotation
  },
  sketch: T
): T => {
  const quaternionToApply = new Quaternion(...transformInfo.quaternion)
  const newQuaternion = new Quaternion(...sketch.rotation).multiply(
    quaternionToApply.invert()
  )

  const oldPosition = new Vector3(...sketch.position)
  const newPosition = oldPosition
    .applyQuaternion(quaternionToApply)
    .add(new Vector3(...transformInfo.position))
  return {
    ...sketch,
    position: newPosition.toArray(),
    rotation: newQuaternion.toArray(),
    __meta: [
      ...sketch.__meta,
      {
        sourceRange,
        pathToNode: [], // TODO
      },
    ],
  }
}

const getExtrudeWallTransform: InternalFn = (
  _,
  pathName: string,
  extrudeGroup: ExtrudeGroup
): {
  position: Position
  quaternion: Rotation
} => {
  const path = extrudeGroup.value.find((path) => path.name === pathName)
  if (!path) throw new Error(`Could not find path with name ${pathName}`)
  return {
    position: path.position,
    quaternion: path.rotation,
  }
}

export const internalFns: { [key in InternalFnNames]: InternalFn } = {
  rx: rotateOnAxis([1, 0, 0]),
  ry: rotateOnAxis([0, 1, 0]),
  rz: rotateOnAxis([0, 0, 1]),
  extrude,
  translate,
  transform,
  getExtrudeWallTransform,
}

function clockwiseSign(points: [number, number][]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const currentPoint = points[i]
    const nextPoint = points[(i + 1) % points.length]
    sum += (nextPoint[0] - currentPoint[0]) * (nextPoint[1] + currentPoint[1])
  }
  return sum >= 0 ? 1 : -1
}
