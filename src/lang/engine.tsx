import {
  BoxGeometry,
  SphereGeometry,
  BufferGeometry,
  PlaneGeometry,
  Quaternion,
  Euler,
} from 'three'
import { Rotation, Position } from './executor'

export function baseGeo({ from }: { from: [number, number, number] }) {
  const baseSphere = new SphereGeometry(0.25)
  baseSphere.translate(from[0], from[1], from[2])
  return baseSphere
}

function trigCalcs({
  from,
  to,
}: {
  from: [number, number, number]
  to: [number, number, number]
}) {
  const sq = (a: number): number => a * a
  const centre = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2,
  ]
  const Hypotenuse3d = Math.sqrt(
    sq(from[0] - to[0]) + sq(from[1] - to[1]) + sq(from[2] - to[2])
  )
  const ry = Math.atan2(from[2] - to[2], from[0] - to[0])
  const Hypotenuse2d = Math.sqrt(sq(from[0] - to[0]) + sq(from[2] - to[2]))
  const rz =
    Math.abs(Math.atan((to[1] - from[1]) / Hypotenuse2d)) *
    Math.sign(to[1] - from[1]) *
    (Math.sign(to[0] - from[0]) || 1)

  const sign = ry === 0 ? 1 : -1
  return {
    centre,
    Hypotenuse: Hypotenuse3d,
    ry,
    rz,
    sign,
  }
}

export function lineGeo({
  from,
  to,
}: {
  from: [number, number, number]
  to: [number, number, number]
}): {
  line: BufferGeometry
  tip: BufferGeometry
  centre: BufferGeometry
} {
  const {
    centre,
    Hypotenuse: Hypotenuse3d,
    ry,
    rz,
    // sign,
  } = trigCalcs({ from, to })

  // create BoxGeometry with size [Hypotenuse3d, 0.1, 0.1] centered at center, with rotation of [0, ry, rz]
  const lineBody = new BoxGeometry(Hypotenuse3d, 0.1, 0.1)
  lineBody.rotateY(ry)
  lineBody.rotateZ(rz)
  lineBody.translate(centre[0], centre[1], centre[2])

  // create line end balls with SphereGeometry at `to` and `from` with radius of 0.15
  const lineEnd1 = new SphereGeometry(0.15)
  lineEnd1.translate(to[0], to[1], to[2])

  const centreSphere = new SphereGeometry(0.15)
  centreSphere.translate(centre[0], centre[1], centre[2])
  // const lineEnd2 = new SphereGeometry(0.15);
  // lineEnd2.translate(from[0], from[1], from[2])

  return {
    line: lineBody,
    tip: lineEnd1,
    centre: centreSphere,
  }
}

export function sketchBaseGeo({ to }: { to: [number, number, number] }): {
  base: BufferGeometry
} {
  return { base: new SphereGeometry(0.25).translate(to[0], to[1], to[2]) }
}

export interface extrudeWallGeo {
  line: BufferGeometry
  tip: BufferGeometry
  centre: BufferGeometry
}

export function extrudeGeo({
  from,
  to,
  length,
  extrusionDirection = 1,
}: {
  from: [number, number, number]
  to: [number, number, number]
  length: number
  extrusionDirection?: number
}): {
  geo: BufferGeometry
  position: Position
  rotation: Rotation
} {
  const {
    centre,
    Hypotenuse: Hypotenuse3d,
    ry,
    rz,
    sign,
  } = trigCalcs({ from, to })

  const face = new PlaneGeometry(Hypotenuse3d, length, 2, 2)
  face.rotateX(Math.PI * 0.5)
  face.translate(Hypotenuse3d * 0.5, 0, -length * 0.5 * sign)

  face.rotateY(ry)
  face.rotateZ(rz)
  face.translate(to[0], to[1], to[2])

  const quat = new Quaternion()
  const otherSign = ry === 0 ? 1 : -1 // don't ask questions, it works okay
  const euler = new Euler(
    (Math.PI * otherSign * extrusionDirection) / 2,
    ry,
    rz * sign * -otherSign,
    'XYZ'
  )
  quat.setFromEuler(euler)

  return {
    geo: face,
    position: [centre[0], centre[1], centre[2]],
    rotation: quat.toArray() as Rotation,
  }
}
