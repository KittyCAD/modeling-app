import {
  ProgramMemory,
  Path,
  SketchGroup,
  ExtrudeGroup,
  SourceRange,
  ExtrudeSurface,
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

export const sketchFns = {
  // base: (
  //   programMemory: ProgramMemory,
  //   name: string = '',
  //   sourceRange: SourceRange,
  //   ...args: any[]
  // ): PathReturn => {
  //   if ((programMemory?._sketch?.length || 0) > 0) {
  //     throw new Error('Base can only be called once')
  //   }
  //   const [x, y] = args as [number, number]
  //   let from: [number, number] = [x, y]
  //   const geo = baseGeo({ from: [x, y, 0] })
  //   const newPath: Path = {
  //     type: 'base',
  //     from,
  //     sourceRange,
  //     geo,
  //   }
  //   return {
  //     programMemory: {
  //       ...programMemory,
  //       _sketch: [...(programMemory?._sketch || []), newPath],
  //     },
  //     currentPath: newPath,
  //   }
  // },
  close: (
    programMemory: ProgramMemory,
    name: string = '',
    sourceRange: SourceRange
  ): PathReturn => {
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
  lineTo: (
    programMemory: ProgramMemory,
    name: string = '',
    sourceRange: SourceRange,
    ...args: any[]
  ): PathReturn => {
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
  rx: rotateOnAxis([1, 0, 0]),
  ry: rotateOnAxis([0, 1, 0]),
  rz: rotateOnAxis([0, 0, 1]),
  extrude: (
    programMemory: ProgramMemory,
    name: string = '',
    sourceRange: SourceRange,
    length: number,
    sketchVal: SketchGroup
  ): ExtrudeGroup => {
    const getSketchGeo = (sketchVal: SketchGroup): SketchGroup => {
      return sketchVal
    }

    const sketch = getSketchGeo(sketchVal)
    const { position, rotation } = sketchVal

    const extrudeSurfaces: ExtrudeSurface[] = []
    sketch.value.map((line, index) => {
      if (line.type === 'toPoint' && index !== 0) {
        const lastPoint = sketch.value[index - 1]
        let from: [number, number] = [0, 0]
        if (lastPoint.type === 'toPoint') {
          from = lastPoint.to
        }
        const to = line.to
        const geo = extrudeGeo({
          from: [from[0], from[1], 0],
          to: [to[0], to[1], 0],
          length,
        })
        extrudeSurfaces.push({
          type: 'extrudePlane',
          position, // todo should come from extrudeGeo
          rotation, // todo should come from extrudeGeo
          __geoMeta: {
            geo,
            sourceRange: line.__geoMeta.sourceRange,
            pathToNode: line.__geoMeta.pathToNode,
          },
        })
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
      ],
    }
  },
  translate,
}

function rotateOnAxis<T extends SketchGroup | ExtrudeGroup>(
  axisMultiplier: [number, number, number]
) {
  return (
    programMemory: ProgramMemory,
    sourceRange: SourceRange,
    rotationD: number,
    sketch: T
  ): T => {
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

function translate<T extends SketchGroup | ExtrudeGroup>(
  programMemory: ProgramMemory,
  sourceRange: SourceRange,
  vec3: [number, number, number],
  sketch: T
): T {
  const oldPosition = new Vector3(...sketch.position)
  const newPosition = oldPosition.add(new Vector3(...vec3))
  return {
    ...sketch,
    position: [newPosition.x, newPosition.y, newPosition.z],
    __meta: [
      ...sketch.__meta,
      {
        sourceRange,
        pathToNode: [], // TODO
      },
    ],
  }
}
