import type { ModelingCmd, Point3d } from '@kittycad/lib'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  getCircularCurveGeometry,
  getCircularFrameGeometry,
} from '@src/lib/gdtCircularFrame'
import { queryModelingCommand } from '@src/lib/engineConnection/utils'
import { getEngineTopologyFallbackNormalized } from '@src/lib/primitiveBodySelection'
import type { Selections } from '@src/machines/modelingSharedTypes'

export type DimensionFunction = 'distance' | 'diameter' | 'radius'

/** Recover current topology only when the selected edge lacks a live reference. */
export async function resolveDimensionSelections(
  selections: Selections,
  engine: Pick<ConnectionManager, 'sendSceneCommand'>
): Promise<Selections | Error> {
  const graphSelections = [...selections.graphSelections]
  for (const [index, selection] of graphSelections.entries()) {
    const reference = selection.entityRef
    let edgeId = selection.engineEntityId ?? selection.artifact?.id
    if (
      selection.artifact?.type === 'edgeCutEdge' &&
      reference?.type !== 'edge'
    ) {
      const id = selection.engineEntityId ?? selection.artifact.id
      const parent = await queryModelingCommand(engine, {
        type: 'entity_get_parent_id',
        entity_id: id,
      })
      const adjacent =
        parent?.type === 'entity_get_parent_id' &&
        (await queryModelingCommand(engine, {
          type: 'solid3d_get_all_edge_faces',
          object_id: parent.data.entity_id,
          edge_id: id,
        }))
      if (
        !adjacent ||
        adjacent.type !== 'solid3d_get_all_edge_faces' ||
        !adjacent.data.faces.length
      )
        return new Error('Could not resolve the selected fillet boundary.')
      graphSelections[index] = {
        ...selection,
        engineEntityId: edgeId,
        entityRef: { type: 'edge', side_faces: adjacent.data.faces },
      }
      continue
    }
    if (edgeId || reference?.type !== 'edge') continue
    const topology = getEngineTopologyFallbackNormalized(selection)
    if (topology) {
      const response = await queryModelingCommand(engine, {
        type: 'solid3d_get_edge_uuid',
        object_id: topology.parentId,
        edge_index: topology.primitiveIndex,
      })
      if (response?.type === 'solid3d_get_edge_uuid')
        edgeId = response.data.edge_id
    } else if (
      reference.side_faces.length === 2 &&
      !reference.end_faces?.length &&
      reference.index === undefined
    ) {
      const parent = await queryModelingCommand(engine, {
        type: 'entity_get_parent_id',
        entity_id: reference.side_faces[0],
      })
      const response =
        parent?.type === 'entity_get_parent_id' &&
        (await queryModelingCommand(engine, {
          type: 'solid3d_get_common_edge',
          object_id: parent.data.entity_id,
          face_ids: reference.side_faces,
        }))
      if (response && response.type === 'solid3d_get_common_edge')
        edgeId = response.data.edge ?? undefined
    }
    if (edgeId)
      graphSelections[index] = { ...selection, engineEntityId: edgeId }
  }
  return { ...selections, graphSelections }
}

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
  return Boolean(getCircularFrameGeometry(points))
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
  const query = (cmd: ModelingCmd) => queryModelingCommand(engine, cmd)
  if (!face) {
    const type = await query({ type: 'curve_get_type', curve_id: id })
    if (
      type?.type !== 'curve_get_type' ||
      !['arc', 'nurbs'].includes(type.data.curve_type)
    )
      return 'distance'
    if (type.data.curve_type === 'nurbs') {
      const controls = await query({
        type: 'curve_get_control_points',
        curve_id: id,
      })
      if (
        controls?.type !== 'curve_get_control_points' ||
        !isCircularArc(controls.data.control_points)
      )
        return 'distance'
    }
    const endpoints = await query({
      type: 'curve_get_end_points',
      curve_id: id,
    })
    if (endpoints?.type !== 'curve_get_end_points') return 'distance'
    const { start, end } = endpoints.data
    return length(subtract(start, end)) <= 1e-6 ? 'diameter' : 'radius'
  }
  // Evaluate circular sections in either native surface parameter direction.
  for (const swap of [false, true]) {
    const sections = await Promise.all(
      [0.25, 0.75].map(async (v) => {
        const points = await Promise.all(
          Array.from({ length: 9 }, async (_, i) => {
            const response = await query({
              type: 'face_get_position',
              object_id: id,
              uv: swap ? { x: v, y: i / 8 } : { x: i / 8, y: v },
            })
            return response?.type === 'face_get_position'
              ? response.data.pos
              : undefined
          })
        )
        return points.filter((p): p is Point3d => p !== undefined)
      })
    )
    if (classifyCylindricalFace(sections[0], sections[1]) === 'distance')
      continue
    const gradient = await query({
      type: 'face_get_gradient',
      object_id: id,
      uv: { x: 0.25, y: 0.25 },
    })
    if (gradient?.type !== 'face_get_gradient') return 'distance'
    if (
      classifyCylindricalFace(
        sections[0],
        sections[1],
        swap ? gradient.data.df_du : gradient.data.df_dv
      ) === 'distance'
    )
      continue
    // Native UV coordinates are not the trimmed domain. Use boundary closure.
    const parent = await query({ type: 'entity_get_parent_id', entity_id: id })
    if (parent?.type !== 'entity_get_parent_id') return 'distance'
    const children = await query({
      type: 'entity_get_all_child_uuids',
      entity_id: parent.data.entity_id,
    })
    if (children?.type !== 'entity_get_all_child_uuids') return 'distance'
    const closed = await Promise.all(
      children.data.entity_ids.map(async (edgeId) => {
        const type = await query({ type: 'get_entity_type', entity_id: edgeId })
        if (
          type?.type !== 'get_entity_type' ||
          type.data.entity_type !== 'edge'
        )
          return false
        const adjacent = await query({
          type: 'solid3d_get_all_edge_faces',
          object_id: parent.data.entity_id,
          edge_id: edgeId,
        })
        if (
          adjacent?.type !== 'solid3d_get_all_edge_faces' ||
          !adjacent.data.faces.includes(id)
        )
          return false
        return Boolean((await getCircularCurveGeometry(engine, edgeId))?.closed)
      })
    )
    return closed.some(Boolean) ? 'diameter' : 'radius'
  }
  return 'distance'
}
