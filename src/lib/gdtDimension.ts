import type { ModelingCmd, Point3d } from '@kittycad/lib'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { unwrapSceneCommandResponse } from '@src/lib/engineConnection/utils'
import { getCircularEdgeCenter } from '@src/lib/gdtFramePosition'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { uuidv4 } from '@src/lib/utils'
import type { Selections } from '@src/machines/modelingSharedTypes'

export type DimensionFunction = 'distance' | 'diameter' | 'radius'

const subtract = (a: Point3d, b: Point3d): Point3d => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
})
const dot = (a: Point3d, b: Point3d) => a.x * b.x + a.y * b.y + a.z * b.z
const length = (a: Point3d) => Math.hypot(a.x, a.y, a.z)
const cross = (a: Point3d, b: Point3d): Point3d => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

export function isCircularArc(points: Point3d[]): boolean {
  if (
    points.length < 3 ||
    points.length % 2 !== 1 ||
    points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
  )
    return false
  const a = subtract(points[1], points[0]),
    b = subtract(points[1], points[2])
  const normal = cross(a, b),
    direction = cross(normal, a)
  const denominator = dot(direction, b)
  if (Math.abs(denominator) <= length(direction) * length(b) * 1e-12)
    return false
  const factor = dot(subtract(points[2], points[0]), b) / denominator
  const center = {
    x: points[0].x + direction.x * factor,
    y: points[0].y + direction.y * factor,
    z: points[0].z + direction.z * factor,
  }
  const radius = length(subtract(points[0], center))
  if (!(radius > 0)) return false
  for (let i = 0; i < points.length - 2; i += 2) {
    for (const j of [i, i + 2]) {
      const radial = subtract(points[j], center),
        tangent = subtract(points[i + 1], points[j])
      if (
        Math.abs(length(radial) - radius) > radius * 1e-5 ||
        Math.abs(dot(radial, tangent)) > radius * length(tangent) * 1e-5 ||
        Math.abs(dot(radial, normal)) > radius * length(normal) * 1e-5
      )
        return false
    }
  }
  return true
}

/** Verify circular cross sections and an axial surface tangent.
 * The tangent rejects spheres with two symmetric, equal-radius sections.
 */
export function classifyCylindricalFace(
  first: Point3d[],
  second: Point3d[],
  axialTangent?: Point3d
): DimensionFunction {
  if (
    first.length !== 9 ||
    second.length !== 9 ||
    [...first, ...second].some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
  )
    return 'distance'
  const a = subtract(first[2], first[0])
  const b = subtract(first[4], first[0])
  const normal = cross(a, b)
  const normalSquared = dot(normal, normal)
  if (normalSquared <= dot(a, a) * dot(b, b) * 1e-12) return 'distance'
  if (
    axialTangent &&
    (![axialTangent.x, axialTangent.y, axialTangent.z].every(Number.isFinite) ||
      !length(axialTangent) ||
      length(cross(axialTangent, normal)) >
        length(axialTangent) * length(normal) * 1e-5)
  )
    return 'distance'
  const bxN = cross(b, normal),
    nxA = cross(normal, a)
  const center: Point3d = {
    x:
      first[0].x +
      (dot(a, a) * bxN.x + dot(b, b) * nxA.x) / (2 * normalSquared),
    y:
      first[0].y +
      (dot(a, a) * bxN.y + dot(b, b) * nxA.y) / (2 * normalSquared),
    z:
      first[0].z +
      (dot(a, a) * bxN.z + dot(b, b) * nxA.z) / (2 * normalSquared),
  }
  const radius = length(subtract(first[0], center))
  const tolerance = radius * 1e-5
  if (!(radius > 0)) return 'distance'
  const translation = subtract(second[0], first[0])
  if (
    length(translation) <= tolerance ||
    length(cross(translation, normal)) >
      length(translation) * length(normal) * 1e-5
  )
    return 'distance'
  for (let i = 0; i < first.length; i++) {
    const radial = subtract(first[i], center)
    if (
      Math.abs(length(radial) - radius) > tolerance ||
      Math.abs(dot(radial, normal)) > tolerance * length(normal) ||
      length(subtract(subtract(second[i], first[i]), translation)) > tolerance
    )
      return 'distance'
  }
  return length(subtract(first[0], first[8])) <= tolerance
    ? 'diameter'
    : 'radius'
}

/** Only a single circular entity changes the existing distance workflow. */
export async function getDimensionFunction(
  selections: Selections,
  engine: Pick<ConnectionManager, 'sendSceneCommand'>
): Promise<DimensionFunction> {
  if (
    selections.graphSelections.length + selections.otherSelections.length !==
    1
  )
    return 'distance'
  const selected = selections.graphSelections[0]
  const primitive = selections.otherSelections[0]
  let id =
    selected?.engineEntityId ??
    (selected?.entityRef?.type === 'face'
      ? selected.entityRef.face_id
      : selected?.artifact?.id)
  let face =
    selected?.entityRef?.type !== 'edge' &&
    (selected?.entityRef?.type === 'face' ||
      ['wall', 'cap', 'edgeCut', 'primitiveFace'].includes(
        selected?.artifact?.type ?? ''
      ))
  if (
    typeof primitive === 'object' &&
    'type' in primitive &&
    primitive.type === 'enginePrimitive'
  ) {
    id = primitive.entityId
    face = primitive.primitiveType === 'face'
  }
  if (!id) return 'distance'
  try {
    if (!face) {
      const response = unwrapSceneCommandResponse(
        await engine.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'curve_get_type', curve_id: id },
        })
      )
      if (
        !isModelingResponse(response) ||
        response.resp.data.modeling_response.type !== 'curve_get_type'
      )
        return 'distance'
      const type = response.resp.data.modeling_response.data.curve_type
      if (!['arc', 'nurbs'].includes(type)) return 'distance'
      if (type === 'nurbs') {
        const controls = unwrapSceneCommandResponse(
          await engine.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: { type: 'curve_get_control_points', curve_id: id },
          })
        )
        if (
          !isModelingResponse(controls) ||
          controls.resp.data.modeling_response.type !==
            'curve_get_control_points' ||
          !isCircularArc(
            controls.resp.data.modeling_response.data.control_points
          )
        )
          return 'distance'
      }
      const endpoints = unwrapSceneCommandResponse(
        await engine.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'curve_get_end_points', curve_id: id },
        })
      )
      if (
        !isModelingResponse(endpoints) ||
        endpoints.resp.data.modeling_response.type !== 'curve_get_end_points'
      )
        return 'distance'
      const { start, end } = endpoints.resp.data.modeling_response.data
      if (
        ![start.x, start.y, start.z, end.x, end.y, end.z].every(Number.isFinite)
      )
        return 'distance'
      return length(subtract(start, end)) <= 1e-6 ? 'diameter' : 'radius'
    }
    // A cylinder may run along either surface parameter. Sample both directions
    // in world space so transformed and imported faces use evaluated geometry.
    for (const swap of [false, true]) {
      const sections = await Promise.all(
        [0.25, 0.75].map(async (v) => {
          const points = await Promise.all(
            Array.from({ length: 9 }, async (_, i) => {
              const response = unwrapSceneCommandResponse(
                await engine.sendSceneCommand({
                  type: 'modeling_cmd_req',
                  cmd_id: uuidv4(),
                  cmd: {
                    type: 'face_get_position',
                    object_id: id,
                    uv: swap ? { x: v, y: i / 8 } : { x: i / 8, y: v },
                  },
                })
              )
              if (
                !isModelingResponse(response) ||
                response.resp.data.modeling_response.type !==
                  'face_get_position'
              )
                return undefined
              return response.resp.data.modeling_response.data.pos
            })
          )
          return points.filter((p): p is Point3d => p !== undefined)
        })
      )
      const kind = classifyCylindricalFace(sections[0], sections[1])
      if (kind !== 'distance') {
        const gradient = unwrapSceneCommandResponse(
          await engine.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'face_get_gradient',
              object_id: id,
              uv: { x: 0.25, y: 0.25 },
            },
          })
        )
        if (
          !isModelingResponse(gradient) ||
          gradient.resp.data.modeling_response.type !== 'face_get_gradient'
        )
          return 'distance'
        const { df_du, df_dv } = gradient.resp.data.modeling_response.data
        if (
          classifyCylindricalFace(
            sections[0],
            sections[1],
            swap ? df_du : df_dv
          ) === 'distance'
        )
          continue
        // UVs are native surface parameters, not a normalized trim domain.
        // Determine closure from the face's boundary topology instead.
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
        const parent = await query({
          type: 'entity_get_parent_id',
          entity_id: id,
        })
        if (parent?.type !== 'entity_get_parent_id') return 'distance'
        const body = parent.data.entity_id
        const children = await query({
          type: 'entity_get_all_child_uuids',
          entity_id: body,
        })
        if (children?.type !== 'entity_get_all_child_uuids') return 'distance'
        const closedBoundaries = await Promise.all(
          children.data.entity_ids.map(async (edgeId) => {
            const type = await query({
              type: 'get_entity_type',
              entity_id: edgeId,
            })
            if (
              type?.type !== 'get_entity_type' ||
              type.data.entity_type !== 'edge'
            )
              return false
            const adjacent = await query({
              type: 'solid3d_get_all_edge_faces',
              object_id: body,
              edge_id: edgeId,
            })
            if (
              adjacent?.type !== 'solid3d_get_all_edge_faces' ||
              !adjacent.data.faces.includes(id)
            )
              return false
            return !!(await getCircularEdgeCenter(engine, edgeId, 'mm'))
          })
        )
        return closedBoundaries.some(Boolean) ? 'diameter' : 'radius'
      }
    }
  } catch {
    // Unavailable or unsupported geometry keeps the existing distance behavior.
  }
  return 'distance'
}
