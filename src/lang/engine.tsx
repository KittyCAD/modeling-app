import { BoxGeometry, SphereGeometry, BufferGeometry } from 'three'
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils'

export function baseGeo({ from }: { from: [number, number, number] }) {
  const baseSphere = new SphereGeometry(0.25)
  baseSphere.translate(from[0], from[1], from[2])
  return baseSphere
}

export interface LineGeos {
  line: BufferGeometry
  tip: BufferGeometry
  centre: BufferGeometry
}

export function lineGeo({
  from,
  to,
}: {
  from: [number, number, number]
  to: [number, number, number]
}): LineGeos {
  const sq = (a: number): number => a * a
  const centre = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2,
  ]
  const Hypotenuse3d = Math.sqrt(
    sq(from[0] - to[0]) + sq(from[1] - to[1]) + sq(from[2] - to[2])
  )
  const ang1 = Math.atan2(from[2] - to[2], from[0] - to[0])
  const Hypotenuse2d = Math.sqrt(sq(from[0] - to[0]) + sq(from[2] - to[2]))
  const ang2 =
    Math.abs(Math.atan((to[1] - from[1]) / Hypotenuse2d)) *
    Math.sign(to[1] - from[1]) *
    (Math.sign(to[0] - from[0]) || 1)

  // create BoxGeometry with size [Hypotenuse3d, 0.1, 0.1] centered at center, with rotation of [0, ang1, ang2]
  const lineBody = new BoxGeometry(Hypotenuse3d, 0.1, 0.1)
  lineBody.rotateY(ang1)
  lineBody.rotateZ(ang2)
  lineBody.translate(centre[0], centre[1], centre[2])

  // create line end balls with SphereGeometry at `to` and `from` with radius of 0.15
  const lineEnd1 = new SphereGeometry(0.15)
  lineEnd1.translate(to[0], to[1], to[2])

  const centreSphere = new SphereGeometry(0.15)
  centreSphere.translate(centre[0], centre[1], centre[2])
  // const lineEnd2 = new SphereGeometry(0.15);
  // lineEnd2.translate(from[0], from[1], from[2])

  // group all three geometries
  // return mergeBufferGeometries([lineBody, lineEnd1])
  // return mergeBufferGeometries([lineBody, lineEnd1, lineEnd2]);
  return {
    line: lineBody,
    tip: lineEnd1,
    centre: centreSphere,
  }
}
