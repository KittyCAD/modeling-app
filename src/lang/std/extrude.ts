import { InternalFn } from './stdTypes'
import {
  ExtrudeGroup,
  ExtrudeSurface,
  SketchGroup,
  Position,
  Rotation,
} from '../executor'
import { Quaternion, Vector3 } from 'three'
import { clockwiseSign } from './std'
import { extrudeGeo } from '../engine'

export const extrude: InternalFn = (
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

export const getExtrudeWallTransform: InternalFn = (
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
