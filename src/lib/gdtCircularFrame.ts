import type { ModelingCmd, Point3d } from '@kittycad/lib'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { unwrapSceneCommandResponse } from '@src/lib/engineConnection/utils'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { uuidv4 } from '@src/lib/utils'

type FramePlane = 'XY' | 'XZ' | 'YZ'
const subtract = (a: Point3d, b: Point3d): Point3d => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
})
const dot = (a: Point3d, b: Point3d) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Point3d, b: Point3d): Point3d => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const length = (p: Point3d) => Math.hypot(p.x, p.y, p.z)

/** Circular control polygons are quadratic: odd points are tangent corners.
 * The normalized 0.5 leader lands halfway through the curve's domain.
 */
export function getCircularFrameGeometry(points: Point3d[]) {
  if (
    points.length < 3 ||
    points.length % 2 !== 1 ||
    points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
  )
    return undefined
  const a = subtract(points[1], points[0])
  const b = subtract(points[1], points[2])
  const normal = cross(a, b)
  const direction = cross(normal, a)
  const denominator = dot(direction, b)
  if (Math.abs(denominator) <= length(direction) * length(b) * 1e-12)
    return undefined
  const factor = dot(subtract(points[2], points[0]), b) / denominator
  const center = {
    x: points[0].x + direction.x * factor,
    y: points[0].y + direction.y * factor,
    z: points[0].z + direction.z * factor,
  }
  const radius = length(subtract(points[0], center))
  for (let i = 0; i < points.length - 2; i += 2) {
    for (const j of [i, i + 2]) {
      const radial = subtract(points[j], center)
      const tangent = subtract(points[i + 1], points[j])
      if (
        Math.abs(length(radial) - radius) > radius * 1e-5 ||
        Math.abs(dot(radial, tangent)) > radius * length(tangent) * 1e-5 ||
        Math.abs(dot(radial, normal)) > radius * length(normal) * 1e-5
      )
        return undefined
    }
  }
  const radial = subtract(points[Math.floor(points.length / 2)], center)
  const radialLength = length(radial)
  if (!(radius > 0) || !(radialLength > 0)) return undefined
  const axis = (['z', 'y', 'x'] as const).reduce((best, axis) =>
    Math.abs(normal[axis]) > Math.abs(normal[best]) ? axis : best
  )
  const framePlane: FramePlane =
    axis === 'z' ? 'XY' : axis === 'y' ? 'XZ' : 'YZ'
  return {
    framePlane,
    normal,
    radius,
    radial: {
      x: (radial.x * radius) / radialLength,
      y: (radial.y * radius) / radialLength,
      z: (radial.z * radius) / radialLength,
    },
  }
}

export type CircularFrameGeometry = NonNullable<
  ReturnType<typeof getCircularFrameGeometry>
>

/** Use the rim's circular plane, rather than a cylinder's varying face normal. */
export async function getCircularFrameGeometryForEntity(
  engine: Pick<ConnectionManager, 'sendSceneCommand'>,
  id: string,
  isEdge: boolean
): Promise<CircularFrameGeometry | undefined> {
  const query = async (cmd: ModelingCmd) => {
    const response = unwrapSceneCommandResponse(
      await engine.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd,
      })
    )
    return isModelingResponse(response)
      ? response.resp.data.modeling_response
      : undefined
  }
  const curve = async (edgeId: string) => {
    const type = await query({ type: 'curve_get_type', curve_id: edgeId })
    if (
      type?.type !== 'curve_get_type' ||
      !['arc', 'nurbs'].includes(type.data.curve_type)
    )
      return undefined
    const controls = await query({
      type: 'curve_get_control_points',
      curve_id: edgeId,
    })
    return controls?.type === 'curve_get_control_points'
      ? getCircularFrameGeometry(controls.data.control_points)
      : undefined
  }
  try {
    if (isEdge) return await curve(id)
    const parent = await query({ type: 'entity_get_parent_id', entity_id: id })
    if (parent?.type !== 'entity_get_parent_id') return undefined
    const body = parent.data.entity_id
    const children = await query({
      type: 'entity_get_all_child_uuids',
      entity_id: body,
    })
    if (children?.type !== 'entity_get_all_child_uuids') return undefined
    const rims = await Promise.all(
      children.data.entity_ids.map(async (edgeId) => {
        const type = await query({ type: 'get_entity_type', entity_id: edgeId })
        if (
          type?.type !== 'get_entity_type' ||
          type.data.entity_type !== 'edge'
        )
          return undefined
        const adjacent = await query({
          type: 'solid3d_get_all_edge_faces',
          object_id: body,
          edge_id: edgeId,
        })
        if (
          adjacent?.type !== 'solid3d_get_all_edge_faces' ||
          !adjacent.data.faces.includes(id)
        )
          return undefined
        return curve(edgeId)
      })
    )
    return rims.find((rim) => rim !== undefined)
  } catch {
    return undefined
  }
}

/** Offsets are relative to the leader. Keep them pointing away from the center,
 * including when the caller supplied a different standard frame plane.
 */
export function getCircularFramePosition(
  geometry: CircularFrameGeometry,
  plane: string,
  unitScale: number,
  fontHeight = 0
): [number, number] | undefined {
  const axes =
    plane === 'XY'
      ? (['x', 'y'] as const)
      : plane === 'XZ'
        ? (['x', 'z'] as const)
        : plane === 'YZ'
          ? (['y', 'z'] as const)
          : undefined
  if (!axes) return undefined
  const radius = geometry.radius / unitScale
  const radialX = geometry.radial[axes[0]]
  const radialY = geometry.radial[axes[1]]
  return [
    (radialX < -geometry.radius * 1e-6 ? -1 : 1) *
      Math.max(radius * 1.2, fontHeight * 2),
    (radialY < -geometry.radius * 1e-6 ? -1 : 1) *
      Math.max(radius * 0.75, fontHeight * 2),
  ]
}
