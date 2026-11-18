import type { Point3d } from '@kittycad/lib'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { queryModelingCommand } from '@src/lib/engineConnection/utils'
import {
  getCircularFramePlane,
  type CircularFrameGeometry,
  type CircularFaceBoundary,
} from '@src/lib/gdtCircularFrame'

const subtract = (a: Point3d, b: Point3d): Point3d => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
})
const add = (a: Point3d, b: Point3d): Point3d => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
})
const scale = (p: Point3d, s: number): Point3d => ({
  x: p.x * s,
  y: p.y * s,
  z: p.z * s,
})
const dot = (a: Point3d, b: Point3d) => a.x * b.x + a.y * b.y + a.z * b.z
const length = (p: Point3d) => Math.hypot(p.x, p.y, p.z)
const cross = (a: Point3d, b: Point3d): Point3d => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

/** Measure the fillet profile from a circular seam or matching end arcs. */
export function getFilletProfileGeometry(boundaries: CircularFaceBoundary[]) {
  const arcs = boundaries.filter((boundary) => !boundary.closed)
  const seams = arcs.filter((arc) => arc.seam)
  const candidates = seams.length
    ? seams
    : arcs.filter(
        (arc) =>
          arcs.filter(
            (other) => Math.abs(other.radius - arc.radius) <= arc.radius * 1e-5
          ).length >= 2
      )
  const first = candidates[0]
  if (
    !first ||
    candidates.some(
      (arc) => Math.abs(arc.radius - first.radius) > first.radius * 1e-5
    )
  )
    return undefined
  return first
}

export async function getFilletProfileFrameGeometry(
  engine: Pick<ConnectionManager, 'sendSceneCommand'>,
  id: string,
  profile: CircularFaceBoundary,
  boundaries: CircularFaceBoundary[]
) {
  const geometry = getFilletFrameGeometry(
    {
      ...profile,
      curvedAxis:
        profile.seam ||
        boundaries.some(
          (boundary) =>
            length(cross(boundary.normal, profile.normal)) >
            length(boundary.normal) * length(profile.normal) * 1e-5
        ),
    },
    boundaries
  )
  if (!profile.seam || geometry.center !== profile.center) return geometry
  const response = await queryModelingCommand(engine, {
    type: 'face_get_center',
    object_id: id,
  })
  if (response?.type !== 'face_get_center') return geometry
  // A closed fillet's seam is at the start of the loop; the 0.5 leader is across it.
  const towardMiddle = subtract(response.data.pos, profile.center)
  return length(towardMiddle) > profile.radius * 1e-5
    ? {
        ...geometry,
        radial: scale(towardMiddle, profile.radius / length(towardMiddle)),
      }
    : geometry
}

/** Align toroidal callouts with the boundary-domain midpoint used by the leader. */
export function getFilletFrameGeometry(
  geometry: CircularFrameGeometry & { curvedAxis: boolean },
  boundaries: CircularFrameGeometry[]
): CircularFrameGeometry {
  if (!geometry.curvedAxis) return boundaries[0] ?? geometry
  for (let i = 0; i < boundaries.length; i++)
    for (let j = i + 1; j < boundaries.length; j++) {
      const a = boundaries[i],
        b = boundaries[j]
      const axis = scale(a.normal, 1 / length(a.normal))
      if (
        length(cross(axis, b.normal)) > length(b.normal) * 1e-5 ||
        length(cross(subtract(a.center, b.center), axis)) >
          geometry.radius * 1e-5
      )
        continue
      const direction = scale(a.radial, 1 / length(a.radial))
      const relative = subtract(geometry.center, a.center)
      const axial = dot(relative, axis)
      const majorRadius = length(subtract(relative, scale(axis, axial)))
      const center = add(
        add(a.center, scale(axis, axial)),
        scale(direction, majorRadius)
      )
      const from = subtract(add(a.center, a.radial), center),
        to = subtract(add(b.center, b.radial), center)
      if (
        Math.abs(length(from) - geometry.radius) > geometry.radius * 1e-5 ||
        Math.abs(length(to) - geometry.radius) > geometry.radius * 1e-5
      )
        continue
      const sum = add(from, to)
      if (length(sum) <= geometry.radius * 1e-5) continue
      const normal = cross(axis, direction)
      return {
        ...geometry,
        center,
        normal,
        framePlane: getCircularFramePlane(normal),
        radial: scale(sum, geometry.radius / length(sum)),
      }
    }
  return geometry
}
