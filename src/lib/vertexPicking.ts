import type { EntityReference, Point2d } from '@kittycad/lib'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { uuidv4 } from '@src/lib/utils'

export type PickedPoint = [number, number, number]

const samePoint = (a: PickedPoint, b: PickedPoint) =>
  Math.hypot(...a.map((value, i) => value - b[i])) < 1e-6

/** Resolve BRep corners using existing topology/curve queries, in engine millimeters.
 * Never infer a vertex from its topology index or the body's bounding box.
 */
export async function resolveVertexPosition({
  reference,
  parentId,
  engine,
  selectedAtWindow,
  project,
}: {
  reference: Extract<EntityReference, { type: 'vertex' }>
  parentId: string
  engine: Pick<ConnectionManager, 'sendSceneCommand'>
  selectedAtWindow?: Point2d
  project?: (point: PickedPoint) => Point2d | undefined
}): Promise<PickedPoint | Error> {
  const faces = [...new Set(reference.side_faces)]
  const edges = new Set<string>()
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const response = await engine.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'solid3d_get_common_edge',
          object_id: parentId,
          face_ids: [faces[i], faces[j]],
        },
      })
      if (!response || !isModelingResponse(response))
        return new Error(
          'Could not read the selected point topology. Try another corner.'
        )
      const result = response.resp.data.modeling_response
      if (result.type !== 'solid3d_get_common_edge')
        return new Error('Unexpected point topology response.')
      if (result.data.edge) edges.add(result.data.edge)
    }
  }
  const endpoints: PickedPoint[][] = []
  for (const edge of edges) {
    const response = await engine.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: { type: 'curve_get_end_points', curve_id: edge },
    })
    if (!response || !isModelingResponse(response))
      return new Error(
        'Could not read the selected point coordinates. Try another corner.'
      )
    const result = response.resp.data.modeling_response
    if (result.type !== 'curve_get_end_points')
      return new Error('Unexpected point coordinate response.')
    endpoints.push(
      [result.data.start, result.data.end].map(({ x, y, z }) => [x, y, z])
    )
  }
  return chooseVertexEndpoint(endpoints, selectedAtWindow, project)
}

export function chooseVertexEndpoint(
  endpoints: PickedPoint[][],
  selectedAtWindow?: Point2d,
  project?: (point: PickedPoint) => Point2d | undefined
): PickedPoint | Error {
  const candidates = (endpoints[0] ?? []).filter(
    (point, i, first) =>
      point.every(Number.isFinite) &&
      first.findIndex((other) => samePoint(point, other)) === i &&
      endpoints.every((edge) => edge.some((other) => samePoint(point, other)))
  )
  if (candidates.length === 1 && (!selectedAtWindow || !project))
    return candidates[0]
  if (selectedAtWindow && project) {
    const near = candidates
      .flatMap((point) => {
        const screen = project(point)
        if (!screen) return []
        const distance = Math.hypot(
          screen.x - selectedAtWindow.x,
          screen.y - selectedAtWindow.y
        )
        return distance <= 12 ? [{ point, distance }] : []
      })
      .sort((a, b) => a.distance - b.distance)
    if (
      near.length &&
      (near.length === 1 || near[1].distance - near[0].distance > 2)
    )
      return near[0].point
  }
  return new Error(
    'This corner could not be resolved unambiguously. Pick another corner or enter coordinates.'
  )
}

export function validatePlanePoints(points: PickedPoint[]): true | Error {
  if (points.length !== 3 || points.some((p) => !p.every(Number.isFinite)))
    return new Error('Select exactly three points on the part.')
  const [a, b, c] = points
  if (samePoint(a, b) || samePoint(a, c) || samePoint(b, c))
    return new Error('Select three distinct points.')
  const u = b.map((value, i) => value - a[i])
  const v = c.map((value, i) => value - a[i])
  const cross = Math.hypot(
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0]
  )
  if (cross <= 1e-10 * Math.hypot(...u) * Math.hypot(...v))
    return new Error('The three points must not lie on one line.')
  return true
}
