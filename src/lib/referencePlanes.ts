import type { VariableMap } from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { isErr } from '@src/lib/trap'
import { baseUnitToMm, uuidv4 } from '@src/lib/utils'
import { validatePlanePoints } from '@src/lib/vertexPicking'
import type { PickedPoint } from '@src/lib/vertexPicking'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import { Vector3 } from 'three'

export type ReferencePlaneKind =
  | 'Offset'
  | 'Midplane'
  | 'Parallel through point'
  | 'Perpendicular bisector'
  | 'Three points'
export type PlaneFrame = {
  origin: PickedPoint
  normal: PickedPoint
  xAxis: PickedPoint
}
type Reference =
  | { type: 'point'; point: PickedPoint }
  | { type: 'plane'; id: string; name?: string }

function graphReference(selection: Selection): Reference | Error {
  const ref = selection.entityRef
  if (ref?.type === 'vertex' && selection.vertexPosition)
    return { type: 'point', point: selection.vertexPosition }
  if (ref?.type === 'plane') return { type: 'plane', id: ref.plane_id }
  if (ref?.type === 'face') return { type: 'plane', id: ref.face_id }
  return new Error('Select planar faces, planes, or corner points.')
}

function references(selection: Selections): Reference[] | Error {
  const refs: Reference[] = []
  for (const item of selection.graphSelections) {
    const ref = graphReference(item)
    if (isErr(ref)) return ref
    refs.push(ref)
  }
  for (const item of selection.otherSelections) {
    if (typeof item === 'object' && 'name' in item)
      refs.push({ type: 'plane', id: item.id, name: item.name })
    else if (
      typeof item === 'object' &&
      'type' in item &&
      item.type === 'enginePrimitive' &&
      item.primitiveType === 'face'
    )
      refs.push({ type: 'plane', id: item.entityId })
    else return new Error('Select planar faces, planes, or corner points.')
  }
  return refs
}

export function inferReferencePlane(
  selection?: Selections
): ReferencePlaneKind | Error {
  if (!selection) return new Error('Select reference geometry for the plane.')
  const refs = references(selection)
  if (isErr(refs)) return refs
  const points = refs.filter((r) => r.type === 'point').length
  const planes = refs.length - points
  if (planes === 1 && points === 0) return 'Offset'
  if (planes === 2 && points === 0) return 'Midplane'
  if (planes === 1 && points === 1) return 'Parallel through point'
  if (planes === 0 && points === 2) return 'Perpendicular bisector'
  if (planes === 0 && points === 3) return 'Three points'
  return new Error(
    'Select one plane, two parallel planes, a plane and a point, or two or three points.'
  )
}

const vector = (point: PickedPoint) => new Vector3(...point)
const tuple = (v: Vector3): PickedPoint => [v.x, v.y, v.z]
function frame(
  origin: PickedPoint,
  normal: PickedPoint,
  xAxis?: PickedPoint
): PlaneFrame | Error {
  if (
    ![...origin, ...normal, ...(xAxis ?? [])].every(Number.isFinite) ||
    vector(normal).length() < 1e-10
  )
    return new Error('The selected geometry does not define a valid plane.')
  const n = vector(normal).normalize()
  const hint = xAxis
    ? vector(xAxis)
    : Math.abs(n.z) < 0.9
      ? new Vector3(0, 0, 1)
      : new Vector3(0, 1, 0)
  const x = hint.addScaledVector(n, -hint.dot(n))
  if (x.length() < 1e-10)
    return new Error('The selected plane has an invalid orientation.')
  return { origin, normal: tuple(n), xAxis: tuple(x.normalize()) }
}

/** Coordinates are engine millimeters; source references are deliberately snapshots. */
export function constructReferencePlane(
  kind: ReferencePlaneKind,
  points: PickedPoint[],
  planes: PlaneFrame[]
): PlaneFrame | Error {
  if (kind === 'Three points') {
    const valid = validatePlanePoints(points)
    if (isErr(valid)) return valid
    const x = vector(points[1]).sub(vector(points[0]))
    return frame(
      points[0],
      tuple(x.clone().cross(vector(points[2]).sub(vector(points[0])))),
      tuple(x)
    )
  }
  if (kind === 'Perpendicular bisector') {
    const normal = vector(points[1]).sub(vector(points[0]))
    if (normal.length() < 1e-6) return new Error('Select two distinct points.')
    return frame(
      tuple(vector(points[0]).add(vector(points[1])).multiplyScalar(0.5)),
      tuple(normal)
    )
  }
  const first = frame(planes[0].origin, planes[0].normal, planes[0].xAxis)
  if (isErr(first)) return first
  if (kind === 'Offset') return first
  if (kind === 'Parallel through point')
    return frame(points[0], first.normal, first.xAxis)
  const second = frame(planes[1].origin, planes[1].normal, planes[1].xAxis)
  if (isErr(second)) return second
  const n = vector(first.normal)
  if (n.clone().cross(vector(second.normal)).length() > 1e-8)
    return new Error('Midplane requires two parallel planar faces or planes.')
  const distance = vector(second.origin).sub(vector(first.origin)).dot(n)
  return frame(
    tuple(vector(first.origin).addScaledVector(n, distance / 2)),
    first.normal,
    first.xAxis
  )
}

export async function resolveReferencePlane(
  selection: Selections,
  variables: VariableMap,
  engine: Pick<ConnectionManager, 'sendSceneCommand'>,
  unitMultiplier: number
): Promise<PlaneFrame | Error> {
  const kind = inferReferencePlane(selection)
  const refs = references(selection)
  if (isErr(kind)) return kind
  if (isErr(refs)) return refs
  const points: PickedPoint[] = []
  const planes: PlaneFrame[] = []
  for (const ref of refs) {
    if (ref.type === 'point') {
      points.push(ref.point)
      continue
    }
    let resolved: PlaneFrame | Error
    if (ref.name) {
      const sign = ref.name.startsWith('-') ? -1 : 1
      const name = ref.name.replace('-', '').toUpperCase()
      resolved =
        name === 'XY'
          ? frame([0, 0, 0], [0, 0, sign], [1, 0, 0])
          : name === 'XZ'
            ? frame([0, 0, 0], [0, -sign, 0], [1, 0, 0])
            : name === 'YZ'
              ? frame([0, 0, 0], [sign, 0, 0], [0, 1, 0])
              : new Error('Unknown reference plane.')
    } else {
      const value = Object.values(variables).find(
        (v) =>
          v?.type === 'Plane' &&
          (v.value.artifactId === ref.id || v.value.id === ref.id)
      )
      if (value?.type === 'Plane') {
        const p = value.value
        const scale = p.origin.units
          ? baseUnitToMm(p.origin.units)
          : unitMultiplier
        resolved = frame(
          [p.origin.x * scale, p.origin.y * scale, p.origin.z * scale],
          [p.zAxis.x, p.zAxis.y, p.zAxis.z],
          [p.xAxis.x, p.xAxis.y, p.xAxis.z]
        )
      } else {
        const response = await engine.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'face_is_planar', object_id: ref.id },
        })
        if (!response || !isModelingResponse(response))
          return new Error(
            'Could not read the selected face. Try selecting it again.'
          )
        const result = response.resp.data.modeling_response
        if (
          result.type !== 'face_is_planar' ||
          !result.data.origin ||
          !result.data.z_axis ||
          !result.data.x_axis
        )
          return new Error(
            'Select a planar face; curved faces cannot define this plane.'
          )
        const { origin, z_axis: n, x_axis: x } = result.data
        resolved = frame(
          [origin.x, origin.y, origin.z],
          [n.x, n.y, n.z],
          [x.x, x.y, x.z]
        )
      }
    }
    if (isErr(resolved)) return resolved
    planes.push(resolved)
  }
  return constructReferencePlane(kind, points, planes)
}
