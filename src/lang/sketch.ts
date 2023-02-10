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
import { InternalFirstArg, InternalFn } from './std/sketchtypes'
import { getCoordsFromPaths, sketchLineHelperMap } from './std/sketch'

export type InternalFnNames =
  | 'extrude'
  | 'translate'
  | 'transform'
  | 'getExtrudeWallTransform'
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
  | 'closee'

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

const startSketchAt: InternalFn = (
  { sourceRange, programMemory },
  data:
    | [number, number]
    | {
        to: [number, number]
        // name?: string
        tag?: string
      }
): SketchGroup => {
  const to = 'to' in data ? data.to : data
  const currentPath: Path = {
    type: 'toPoint',
    to,
    from: to,
    __geoMeta: {
      sourceRange,
      pathToNode: [], // TODO
      geos: [],
    },
  }
  if ('tag' in data) {
    currentPath.name = data.tag
  }
  return {
    type: 'sketchGroup',
    start: to,
    value: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    __meta: [
      {
        sourceRange,
        pathToNode: [], // TODO
      },
    ],
  }
}

const closee: InternalFn = (
  { sourceRange, programMemory },
  sketchGroup: SketchGroup
): SketchGroup => {
  const from = getCoordsFromPaths(sketchGroup, sketchGroup.value.length - 1)
  const to = getCoordsFromPaths(sketchGroup, 0)
  const geo = lineGeo({
    from: [...from, 0],
    to: [...to, 0],
  })
  const currentPath: Path = {
    type: 'toPoint',
    to,
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
  const newValue = [...sketchGroup.value]
  newValue[0] = currentPath
  return {
    ...sketchGroup,
    value: newValue,
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
  lineTo: sketchLineHelperMap.lineTo.fn,
  xLineTo: sketchLineHelperMap.xLineTo.fn,
  yLineTo: sketchLineHelperMap.yLineTo.fn,
  line: sketchLineHelperMap.line.fn,
  xLine: sketchLineHelperMap.xLine.fn,
  yLine: sketchLineHelperMap.yLine.fn,
  angledLine: sketchLineHelperMap.angledLine.fn,
  angledLineOfXLength: sketchLineHelperMap.angledLineOfXLength.fn,
  angledLineToX: sketchLineHelperMap.angledLineToX.fn,
  angledLineOfYLength: sketchLineHelperMap.angledLineOfYLength.fn,
  angledLineToY: sketchLineHelperMap.angledLineToY.fn,
  startSketchAt,
  closee,
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

export function getYComponent(
  angleDegree: number,
  xComponent: number
): [number, number] {
  const normalisedAngle = ((angleDegree % 360) + 360) % 360 // between 0 and 360
  let yComponent = xComponent * Math.tan((normalisedAngle * Math.PI) / 180)
  const sign = normalisedAngle > 90 && normalisedAngle <= 270 ? -1 : 1
  return [sign * xComponent, sign * yComponent]
}

export function getXComponent(
  angleDegree: number,
  yComponent: number
): [number, number] {
  const normalisedAngle = ((angleDegree % 360) + 360) % 360 // between 0 and 360
  let xComponent = yComponent / Math.tan((normalisedAngle * Math.PI) / 180)
  const sign = normalisedAngle > 180 && normalisedAngle <= 360 ? -1 : 1
  return [sign * xComponent, sign * yComponent]
}
