import {
  lineTo,
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
  close,
  startSketchAt,
  angledLineThatIntersects,
} from './sketch'
import {
  segLen,
  segAng,
  angleToMatchLengthX,
  angleToMatchLengthY,
  segEndX,
  segEndY,
  lastSegX,
  lastSegY,
} from './sketchConstraints'
import { getExtrudeWallTransform, extrude } from './extrude'
import { SketchGroup, ExtrudeGroup, Position, Rotation } from '../executor'

import { InternalFn, InternalFnNames, InternalFirstArg } from './stdTypes'

// const transform: InternalFn = <T extends SketchGroup | ExtrudeGroup>(
//   { sourceRange }: InternalFirstArg,
//   transformInfo: {
//     position: Position
//     quaternion: Rotation
//   },
//   sketch: T
// ): T => {
//   const quaternionToApply = new Quaternion(...transformInfo?.quaternion)
//   const newQuaternion = new Quaternion(...sketch.rotation).multiply(
//     quaternionToApply.invert()
//   )

//   const oldPosition = new Vector3(...sketch?.position)
//   const newPosition = oldPosition
//     .applyQuaternion(quaternionToApply)
//     .add(new Vector3(...transformInfo?.position))
//   return {
//     ...sketch,
//     position: newPosition.toArray(),
//     rotation: newQuaternion.toArray(),
//     __meta: [
//       ...sketch.__meta,
//       {
//         sourceRange,
//         pathToNode: [], // TODO
//       },
//     ],
//   }
// }

// const translate: InternalFn = <T extends SketchGroup | ExtrudeGroup>(
//   { sourceRange }: InternalFirstArg,
//   vec3: [number, number, number],
//   sketch: T
// ): T => {
//   const oldPosition = new Vector3(...sketch.position)
//   const newPosition = oldPosition.add(new Vector3(...vec3))
//   return {
//     ...sketch,
//     position: newPosition.toArray(),
//     __meta: [
//       ...sketch.__meta,
//       {
//         sourceRange,
//         pathToNode: [], // TODO
//       },
//     ],
//   }
// }

const min: InternalFn = (_, a: number, b: number): number => Math.min(a, b)

const legLen: InternalFn = (_, hypotenuse: number, leg: number): number =>
  Math.sqrt(
    hypotenuse ** 2 - Math.min(Math.abs(leg), Math.abs(hypotenuse)) ** 2
  )

const legAngX: InternalFn = (_, hypotenuse: number, leg: number): number =>
  (Math.acos(Math.min(leg, hypotenuse) / hypotenuse) * 180) / Math.PI

const legAngY: InternalFn = (_, hypotenuse: number, leg: number): number =>
  (Math.asin(Math.min(leg, hypotenuse) / hypotenuse) * 180) / Math.PI

export const internalFns: { [key in InternalFnNames]: InternalFn } = {
  // TODO - re-enable these
  // rx: rotateOnAxis([1, 0, 0]),
  // ry: rotateOnAxis([0, 1, 0]),
  // rz: rotateOnAxis([0, 0, 1]),
  extrude,
  // translate,
  // transform,
  getExtrudeWallTransform,
  min,
  legLen,
  legAngX,
  legAngY,
  segEndX,
  segEndY,
  lastSegX,
  lastSegY,
  segLen,
  segAng,
  angleToMatchLengthX,
  angleToMatchLengthY,
  lineTo: lineTo.fn,
  xLineTo: xLineTo.fn,
  yLineTo: yLineTo.fn,
  line: line.fn,
  xLine: xLine.fn,
  yLine: yLine.fn,
  angledLine: angledLine.fn,
  angledLineOfXLength: angledLineOfXLength.fn,
  angledLineToX: angledLineToX.fn,
  angledLineOfYLength: angledLineOfYLength.fn,
  angledLineToY: angledLineToY.fn,
  angledLineThatIntersects: angledLineThatIntersects.fn,
  startSketchAt,
  close,
}

// function rotateOnAxis<T extends SketchGroup | ExtrudeGroup>(
//   axisMultiplier: [number, number, number]
// ): InternalFn {
//   return ({ sourceRange }, rotationD: number, sketch: T): T => {
//     const rotationR = rotationD * (Math.PI / 180)
//     const rotateVec = new Vector3(...axisMultiplier)
//     const quaternion = new Quaternion()
//     quaternion.setFromAxisAngle(rotateVec, rotationR)

//     const position = new Vector3(...sketch.position)
//       .applyQuaternion(quaternion)
//       .toArray()

//     const existingQuat = new Quaternion(...sketch.rotation)
//     const rotation = quaternion.multiply(existingQuat).toArray()
//     return {
//       ...sketch,
//       rotation,
//       position,
//       __meta: [
//         ...sketch.__meta,
//         {
//           sourceRange,
//           pathToNode: [], // TODO
//         },
//       ],
//     }
//   }
// }

export function clockwiseSign(points: [number, number][]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const currentPoint = points[i]
    const nextPoint = points[(i + 1) % points.length]
    sum += (nextPoint[0] - currentPoint[0]) * (nextPoint[1] + currentPoint[1])
  }
  return sum >= 0 ? 1 : -1
}
