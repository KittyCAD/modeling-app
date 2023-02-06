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
  | 'lineTTo'
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

const lineTTo: InternalFn = (
  { sourceRange, programMemory },
  data:
    | [number, number]
    | {
        to: [number, number]
        // name?: string
        tag?: string
      },
  previousSketch: SketchGroup
): SketchGroup => {
  if (!previousSketch)
    throw new Error('lineTTo must be called after startSketchAt')
  const sketchGroup = { ...previousSketch }
  const from = getCoordsFromPaths(
    sketchGroup.value,
    sketchGroup.value.length - 1
  )
  const to = 'to' in data ? data.to : data
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
  if ('tag' in data) {
    currentPath.name = data.tag
  }
  return {
    ...sketchGroup,
    value: [...sketchGroup.value, currentPath],
  }
}

const line: InternalFn = (
  { sourceRange, programMemory },
  data:
    | [number, number]
    | {
        to: [number, number]
        // name?: string
        tag?: string
      },
  previousSketch: SketchGroup
): SketchGroup => {
  if (!previousSketch) throw new Error('lineTTo must be called after lineTo')
  const sketchGroup = { ...previousSketch }
  const from = getCoordsFromPaths(
    sketchGroup.value,
    sketchGroup.value.length - 1
  )
  const args = 'to' in data ? data.to : data
  const to: [number, number] = [from[0] + args[0], from[1] + args[1]]
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
  if ('tag' in data) {
    currentPath.name = data.tag
  }
  return {
    ...sketchGroup,
    value: [...sketchGroup.value, currentPath],
  }
}

const xLine: InternalFn = (
  meta,
  data:
    | number
    | {
        to: number
        // name?: string
        tag?: string
      },
  previousSketch: SketchGroup
): SketchGroup => {
  if (!previousSketch) throw new Error('bad bad bad')
  const xVal = typeof data !== 'number' ? data.to : data
  return line(meta, [xVal, 0], previousSketch)
}

const yLine: InternalFn = (
  meta,
  data:
    | number
    | {
        to: number
        // name?: string
        tag?: string
      },
  previousSketch: SketchGroup
): SketchGroup => {
  if (!previousSketch) throw new Error('bad bad bad')
  const yVal = typeof data !== 'number' ? data.to : data
  return line(meta, [0, yVal], previousSketch)
}

const xLineTo: InternalFn = (
  meta,
  data:
    | number
    | {
        to: number
        // name?: string
        tag?: string
      },
  previousSketch: SketchGroup
): SketchGroup => {
  if (!previousSketch) throw new Error('bad bad bad')
  const from = getCoordsFromPaths(
    previousSketch.value,
    previousSketch.value.length - 1
  )
  const xVal = typeof data !== 'number' ? data.to : data
  return lineTTo(meta, [xVal, from[1]], previousSketch)
}

const yLineTo: InternalFn = (
  meta,
  data:
    | number
    | {
        to: number
        // name?: string
        tag?: string
      },
  previousSketch: SketchGroup
): SketchGroup => {
  if (!previousSketch) throw new Error('bad bad bad')
  const from = getCoordsFromPaths(
    previousSketch.value,
    previousSketch.value.length - 1
  )
  const yVal = typeof data !== 'number' ? data.to : data
  return lineTTo(meta, [from[0], yVal], previousSketch)
}

const angledLine: InternalFn = (
  { sourceRange, programMemory },
  data:
    | [number, number]
    | {
        angle: number
        length: number
        // name?: string
        tag?: string
      },
  previousSketch: SketchGroup
): SketchGroup => {
  if (!previousSketch) throw new Error('lineTTo must be called after lineTo')
  const sketchGroup = { ...previousSketch }
  const from = getCoordsFromPaths(
    sketchGroup.value,
    sketchGroup.value.length - 1
  )
  const [angle, length] = 'angle' in data ? [data.angle, data.length] : data
  const to: [number, number] = [
    from[0] + length * Math.cos((angle * Math.PI) / 180),
    from[1] + length * Math.sin((angle * Math.PI) / 180),
  ]
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
  if ('tag' in data) {
    currentPath.name = data.tag
  }
  return {
    ...sketchGroup,
    value: [...sketchGroup.value, currentPath],
  }
}

const angledLineOfXLength: InternalFn = (
  { sourceRange, programMemory },
  data:
    | [number, number]
    | {
        angle: number
        length: number
        // name?: string
        tag?: string
      },
  previousSketch: SketchGroup
): SketchGroup => {
  if (!previousSketch) throw new Error('lineTTo must be called after lineTo')
  const [angle, length] = 'angle' in data ? [data.angle, data.length] : data
  return line(
    { sourceRange, programMemory },
    getYComponent(angle, length),
    previousSketch
  )
}

const angledLineOfYLength: InternalFn = (
  { sourceRange, programMemory },
  data:
    | [number, number]
    | {
        angle: number
        length: number
        tag?: string
      },
  previousSketch: SketchGroup
): SketchGroup => {
  if (!previousSketch) throw new Error('lineTTo must be called after lineTo')
  const [angle, length] = 'angle' in data ? [data.angle, data.length] : data
  return line(
    { sourceRange, programMemory },
    getXComponent(angle, length),
    previousSketch
  )
}

const angledLineToX: InternalFn = (
  { sourceRange, programMemory },
  data:
    | [number, number]
    | {
        angle: number
        to: number
        tag?: string
      },
  previousSketch: SketchGroup
): SketchGroup => {
  if (!previousSketch) throw new Error('lineTTo must be called after lineTo')
  const from = getCoordsFromPaths(
    previousSketch.value,
    previousSketch.value.length - 1
  )
  const [angle, xTo] = 'angle' in data ? [data.angle, data.to] : data
  const xComponent = xTo - from[0]
  const yComponent = xComponent * Math.tan((angle * Math.PI) / 180)
  return lineTTo(
    { sourceRange, programMemory },
    [xTo, from[1] + yComponent],
    previousSketch
  )
}

const angledLineToY: InternalFn = (
  { sourceRange, programMemory },
  data:
    | [number, number]
    | {
        angle: number
        to: number
        tag?: string
      },
  previousSketch: SketchGroup
): SketchGroup => {
  if (!previousSketch) throw new Error('lineTTo must be called after lineTo')
  const from = getCoordsFromPaths(
    previousSketch.value,
    previousSketch.value.length - 1
  )
  const [angle, yTo] = 'angle' in data ? [data.angle, data.to] : data
  const yComponent = yTo - from[1]
  const xComponent = yComponent / Math.tan((angle * Math.PI) / 180)
  return lineTTo(
    { sourceRange, programMemory },
    [from[0] + xComponent, yTo],
    previousSketch
  )
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
    value: [currentPath],
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
  const from = getCoordsFromPaths(
    sketchGroup.value,
    sketchGroup.value.length - 1
  )
  const to = getCoordsFromPaths(sketchGroup.value, 0)
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
  lineTTo,
  xLineTo,
  yLineTo,
  line,
  xLine,
  yLine,
  angledLine,
  angledLineOfXLength,
  angledLineToX,
  angledLineOfYLength,
  angledLineToY,
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
