import type {
  ApiObject,
  ConstraintSegment,
  SceneGraphDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import {
  isArcSegment,
  isCircleSegment,
  isConstraint,
  isLineSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import type { SketchSolveScenePluginContext } from '@src/registry/contracts/sketchSolveScene'
import {
  type Group,
  Mesh,
  OrthographicCamera,
  Plane,
  PlaneGeometry,
  Ray,
  ShaderMaterial,
  Vector3,
  Vector4,
} from 'three'

export const RESIDUALS_UNDERLAY_OBJECT_NAME = 'sketch-residuals-underlay'
export const MAX_RESIDUAL_FIELDS = 32

export const RESIDUAL_FIELD_KIND = {
  point: 1,
  x: 2,
  y: 3,
  circle: 4,
  line: 5,
  horizontalDistance: 6,
  verticalDistance: 7,
} as const

type ResidualFieldKind =
  (typeof RESIDUAL_FIELD_KIND)[keyof typeof RESIDUAL_FIELD_KIND]

export type ResidualField = {
  kind: ResidualFieldKind
  a: [number, number, number]
  b?: [number, number, number]
}

type Point2d = {
  x: number
  y: number
}

type Bounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type ResidualDebugSettings = SettingsType['debug'] & {
  showSketchResiduals?: { current?: boolean }
}

type ResidualsUnderlayMesh = Mesh<PlaneGeometry, ShaderMaterial>

const EMPTY_FIELD = new Vector4(0, 0, 0, 0)

const vertexShader = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = `
precision highp float;

varying vec2 vUv;

uniform vec4 uBounds;
uniform int uFieldCount;
uniform vec4 uFieldA[${MAX_RESIDUAL_FIELDS}];
uniform vec4 uFieldB[${MAX_RESIDUAL_FIELDS}];

const float ZERO_RESIDUAL_THRESHOLD = 0.08;
const float EPSILON = 0.0001;

float distanceToLine(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float len = length(ab);
  if (len < EPSILON) {
    return length(p - a);
  }
  return abs((p.x - a.x) * ab.y - (p.y - a.y) * ab.x) / len;
}

float residualForField(vec2 p, vec4 a, vec4 b) {
  float kind = a.w;
  if (kind < 1.5) {
    return length(p - a.xy);
  }
  if (kind < 2.5) {
    return abs(p.x - a.x);
  }
  if (kind < 3.5) {
    return abs(p.y - a.y);
  }
  if (kind < 4.5) {
    return abs(length(p - a.xy) - abs(a.z));
  }
  if (kind < 5.5) {
    return distanceToLine(p, a.xy, b.xy);
  }
  if (kind < 6.5) {
    return abs(abs(p.x - a.x) - abs(a.z));
  }
  return abs(abs(p.y - a.y) - abs(a.z));
}

void main() {
  if (uFieldCount <= 0) {
    discard;
  }

  vec2 p = mix(uBounds.xy, uBounds.zw, vUv);
  float mag = 1.0e20;

  for (int i = 0; i < ${MAX_RESIDUAL_FIELDS}; i++) {
    if (i >= uFieldCount) {
      break;
    }
    mag = min(mag, residualForField(p, uFieldA[i], uFieldB[i]));
  }

  vec3 turquoise = vec3(64.0 / 255.0, 224.0 / 255.0, 208.0 / 255.0);
  vec3 color;
  float alpha;
  if (mag < ZERO_RESIDUAL_THRESHOLD) {
    color = turquoise;
    alpha = 0.32;
  } else {
    float fractional = fract(mag);
    float intensity = 1.0 - fractional;
    color = vec3(intensity);
    alpha = mix(0.10, 0.24, intensity);
  }

  gl_FragColor = vec4(color, alpha);
}
`

function shouldShowResiduals(settings: SettingsType) {
  return (
    (settings.debug as ResidualDebugSettings).showSketchResiduals?.current ===
    true
  )
}

export function updateResidualsUnderlay(
  context: SketchSolveScenePluginContext
): void {
  if (!shouldShowResiduals(context.settings)) {
    removeResidualsUnderlay(context.sketchSolveGroup)
    return
  }

  const fields = buildResidualFieldsForSceneGraph(
    context.sceneGraphDelta,
    context.sketchId
  )
  if (!fields.length) {
    removeResidualsUnderlay(context.sketchSolveGroup)
    return
  }

  const bounds =
    getVisibleSketchBounds(context) ??
    getSceneGraphBounds(context.sceneGraphDelta, context.sketchId)
  const underlay = getOrCreateResidualsUnderlay(context.sketchSolveGroup)

  updateUnderlayBounds(underlay, bounds)
  updateUnderlayFields(underlay, fields)
}

export function buildResidualFieldsForSceneGraph(
  sceneGraphDelta: SceneGraphDelta,
  sketchId: number
): ResidualField[] {
  const objects = getCurrentSketchObjectsById(
    sceneGraphDelta.new_graph.objects,
    sketchId
  )
  const fields: ResidualField[] = []

  for (const object of objects) {
    if (!isConstraint(object)) {
      continue
    }

    appendConstraintFields(fields, object, objects)
    if (fields.length >= MAX_RESIDUAL_FIELDS) {
      break
    }
  }

  return fields.slice(0, MAX_RESIDUAL_FIELDS)
}

function appendConstraintFields(
  fields: ResidualField[],
  object: ApiObject,
  objects: ApiObject[]
) {
  if (!isConstraint(object)) {
    return
  }

  const constraint = object.kind.constraint
  switch (constraint.type) {
    case 'Coincident':
      appendCoincidentFields(fields, constraint.segments, objects)
      break
    case 'Distance':
      appendDistanceFields(
        fields,
        constraint.points,
        objects,
        constraint.distance.value
      )
      break
    case 'HorizontalDistance':
      appendAxisDistanceFields(
        fields,
        constraint.points,
        objects,
        constraint.distance.value,
        'x'
      )
      break
    case 'VerticalDistance':
      appendAxisDistanceFields(
        fields,
        constraint.points,
        objects,
        constraint.distance.value,
        'y'
      )
      break
    case 'Fixed':
      for (const fixedPoint of constraint.points) {
        addPointField(fields, {
          x: fixedPoint.position.x.value,
          y: fixedPoint.position.y.value,
        })
      }
      break
    case 'Horizontal':
      appendAxisFields(fields, constraint, objects, 'y')
      break
    case 'Vertical':
      appendAxisFields(fields, constraint, objects, 'x')
      break
    case 'Midpoint':
      appendMidpointField(fields, constraint.point, constraint.segment, objects)
      break
    case 'Radius':
      appendRadiusField(
        fields,
        constraint.arc,
        objects,
        constraint.radius.value
      )
      break
    case 'Diameter':
      appendRadiusField(
        fields,
        constraint.arc,
        objects,
        constraint.diameter.value / 2
      )
      break
    case 'EqualRadius':
      appendEqualRadiusFields(fields, constraint.input, objects)
      break
    case 'LinesEqualLength':
      appendEqualLengthFields(fields, constraint.lines, objects)
      break
  }
}

function appendCoincidentFields(
  fields: ResidualField[],
  segments: ConstraintSegment[],
  objects: ApiObject[]
) {
  if (segments.length < 2) {
    return
  }

  const first = segments[0]
  const second = segments[1]
  const firstPoint = pointForConstraintSegment(first, objects)
  const secondPoint = pointForConstraintSegment(second, objects)

  if (firstPoint && secondPoint) {
    if (first === 'ORIGIN') {
      addPointField(fields, firstPoint)
      return
    }
    if (second === 'ORIGIN') {
      addPointField(fields, secondPoint)
      return
    }

    addPointField(fields, firstPoint)
    addPointField(fields, secondPoint)
    return
  }

  appendPointOnObjectField(fields, first, second, objects)
  appendPointOnObjectField(fields, second, first, objects)
}

function appendPointOnObjectField(
  fields: ResidualField[],
  maybePoint: ConstraintSegment,
  maybeObject: ConstraintSegment,
  objects: ApiObject[]
) {
  if (!pointForConstraintSegment(maybePoint, objects)) {
    return
  }
  if (maybeObject === 'ORIGIN') {
    addPointField(fields, { x: 0, y: 0 })
    return
  }

  const object = objects[maybeObject]
  const linePoints = getLinePoints(object, objects)
  if (linePoints) {
    addLineField(fields, linePoints[0], linePoints[1])
    return
  }

  const arc = getArcCenterAndRadius(object, objects)
  if (arc) {
    addCircleField(fields, arc.center, arc.radius)
  }
}

function appendDistanceFields(
  fields: ResidualField[],
  segments: ConstraintSegment[],
  objects: ApiObject[],
  distance: number
) {
  for (const segment of segments) {
    const point = pointForConstraintSegment(segment, objects)
    if (point) {
      addCircleField(fields, point, distance)
    }
  }
}

function appendAxisDistanceFields(
  fields: ResidualField[],
  segments: ConstraintSegment[],
  objects: ApiObject[],
  distance: number,
  axis: 'x' | 'y'
) {
  for (const segment of segments) {
    const point = pointForConstraintSegment(segment, objects)
    if (!point) {
      continue
    }
    fields.push({
      kind:
        axis === 'x'
          ? RESIDUAL_FIELD_KIND.horizontalDistance
          : RESIDUAL_FIELD_KIND.verticalDistance,
      a: [point.x, point.y, distance],
    })
  }
}

function appendAxisFields(
  fields: ResidualField[],
  constraint: { line: number } | { points: ConstraintSegment[] },
  objects: ApiObject[],
  axis: 'x' | 'y'
) {
  if ('line' in constraint) {
    const linePoints = getLinePoints(objects[constraint.line], objects)
    if (!linePoints) {
      return
    }
    addAxisField(fields, linePoints[0], axis)
    return
  }

  const firstPoint = pointForConstraintSegment(constraint.points[0], objects)
  if (firstPoint) {
    addAxisField(fields, firstPoint, axis)
  }
}

function appendMidpointField(
  fields: ResidualField[],
  pointId: number,
  segmentId: number,
  objects: ApiObject[]
) {
  const midpoint = getSegmentMidpoint(objects[segmentId], objects)
  const point = objects[pointId]
  if (!midpoint || !isPointSegment(point)) {
    return
  }
  addPointField(fields, midpoint)
}

function appendRadiusField(
  fields: ResidualField[],
  arcId: number,
  objects: ApiObject[],
  radius: number
) {
  const arc = getArcCenterAndRadius(objects[arcId], objects)
  if (!arc) {
    return
  }
  addCircleField(fields, arc.center, radius)
}

function appendEqualRadiusFields(
  fields: ResidualField[],
  input: number[],
  objects: ApiObject[]
) {
  const reference = getArcCenterAndRadius(objects[input[0]], objects)
  if (!reference) {
    return
  }

  for (const arcId of input.slice(1)) {
    const arc = getArcCenterAndRadius(objects[arcId], objects)
    if (arc) {
      addCircleField(fields, arc.center, reference.radius)
    }
  }
}

function appendEqualLengthFields(
  fields: ResidualField[],
  lines: number[],
  objects: ApiObject[]
) {
  const referenceLine = getLinePoints(objects[lines[0]], objects)
  if (!referenceLine) {
    return
  }

  const referenceLength = distance(referenceLine[0], referenceLine[1])
  for (const lineId of lines.slice(1)) {
    const line = getLinePoints(objects[lineId], objects)
    if (line) {
      addCircleField(fields, line[0], referenceLength)
    }
  }
}

function addPointField(fields: ResidualField[], point: Point2d) {
  fields.push({
    kind: RESIDUAL_FIELD_KIND.point,
    a: [point.x, point.y, 0],
  })
}

function addAxisField(
  fields: ResidualField[],
  point: Point2d,
  axis: 'x' | 'y'
) {
  fields.push({
    kind: axis === 'x' ? RESIDUAL_FIELD_KIND.x : RESIDUAL_FIELD_KIND.y,
    a: [point.x, point.y, 0],
  })
}

function addCircleField(
  fields: ResidualField[],
  center: Point2d,
  radius: number
) {
  fields.push({
    kind: RESIDUAL_FIELD_KIND.circle,
    a: [center.x, center.y, radius],
  })
}

function addLineField(fields: ResidualField[], start: Point2d, end: Point2d) {
  fields.push({
    kind: RESIDUAL_FIELD_KIND.line,
    a: [start.x, start.y, 0],
    b: [end.x, end.y, 0],
  })
}

function pointForConstraintSegment(
  segment: ConstraintSegment | undefined,
  objects: ApiObject[]
): Point2d | null {
  if (segment === undefined) {
    return null
  }
  if (segment === 'ORIGIN') {
    return { x: 0, y: 0 }
  }

  return pointForObject(objects[segment])
}

function pointForObject(object: ApiObject | undefined): Point2d | null {
  if (!isPointSegment(object)) {
    return null
  }

  return {
    x: object.kind.segment.position.x.value,
    y: object.kind.segment.position.y.value,
  }
}

function getLinePoints(
  object: ApiObject | undefined,
  objects: ApiObject[]
): [Point2d, Point2d] | null {
  if (!isLineSegment(object)) {
    return null
  }

  const start = pointForObject(objects[object.kind.segment.start])
  const end = pointForObject(objects[object.kind.segment.end])
  if (!start || !end) {
    return null
  }

  return [start, end]
}

function getArcCenterAndRadius(
  object: ApiObject | undefined,
  objects: ApiObject[]
): { center: Point2d; radius: number } | null {
  if (!isArcSegment(object) && !isCircleSegment(object)) {
    return null
  }

  const center = pointForObject(objects[object.kind.segment.center])
  const start = pointForObject(objects[object.kind.segment.start])
  if (!center || !start) {
    return null
  }

  return { center, radius: distance(center, start) }
}

function getSegmentMidpoint(
  object: ApiObject | undefined,
  objects: ApiObject[]
): Point2d | null {
  const line = getLinePoints(object, objects)
  if (line) {
    return midpoint(line[0], line[1])
  }

  const arc = getArcCenterAndRadius(object, objects)
  if (arc) {
    return arc.center
  }

  return null
}

function midpoint(a: Point2d, b: Point2d): Point2d {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  }
}

function distance(a: Point2d, b: Point2d): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function getOrCreateResidualsUnderlay(group: Group): ResidualsUnderlayMesh {
  const existing = group.getObjectByName(RESIDUALS_UNDERLAY_OBJECT_NAME)
  if (existing instanceof Mesh && existing.material instanceof ShaderMaterial) {
    return existing as ResidualsUnderlayMesh
  }

  const mesh = new Mesh(
    new PlaneGeometry(1, 1, 1, 1),
    new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uBounds: { value: new Vector4(-10, -10, 10, 10) },
        uFieldCount: { value: 0 },
        uFieldA: { value: createFieldUniforms() },
        uFieldB: { value: createFieldUniforms() },
      },
    })
  ) as ResidualsUnderlayMesh

  mesh.name = RESIDUALS_UNDERLAY_OBJECT_NAME
  mesh.renderOrder = -1000
  mesh.layers.set(SKETCH_LAYER)
  mesh.raycast = () => undefined
  group.add(mesh)

  return mesh
}

function updateUnderlayBounds(mesh: ResidualsUnderlayMesh, bounds: Bounds) {
  const width = Math.max(bounds.maxX - bounds.minX, 1)
  const height = Math.max(bounds.maxY - bounds.minY, 1)
  const centerX = bounds.minX + width / 2
  const centerY = bounds.minY + height / 2

  mesh.position.set(centerX, centerY, -0.002)
  mesh.scale.set(width, height, 1)
  mesh.material.uniforms.uBounds.value.set(
    bounds.minX,
    bounds.minY,
    bounds.maxX,
    bounds.maxY
  )
}

function updateUnderlayFields(
  mesh: ResidualsUnderlayMesh,
  fields: ResidualField[]
) {
  const count = Math.min(fields.length, MAX_RESIDUAL_FIELDS)
  mesh.material.uniforms.uFieldCount.value = count

  for (let index = 0; index < MAX_RESIDUAL_FIELDS; index++) {
    const field = fields[index]
    const fieldA = mesh.material.uniforms.uFieldA.value[index] as Vector4
    const fieldB = mesh.material.uniforms.uFieldB.value[index] as Vector4

    if (!field || index >= count) {
      fieldA.copy(EMPTY_FIELD)
      fieldB.copy(EMPTY_FIELD)
      continue
    }

    fieldA.set(field.a[0], field.a[1], field.a[2], field.kind)
    fieldB.set(
      field.b?.[0] ?? 0,
      field.b?.[1] ?? 0,
      field.b?.[2] ?? 0,
      field.kind
    )
  }
}

function createFieldUniforms() {
  return Array.from(
    { length: MAX_RESIDUAL_FIELDS },
    () => new Vector4(0, 0, 0, 0)
  )
}

function removeResidualsUnderlay(group: Group) {
  const existing = group.getObjectByName(RESIDUALS_UNDERLAY_OBJECT_NAME)
  if (!(existing instanceof Mesh)) {
    return
  }

  if (existing.geometry) {
    existing.geometry.dispose()
  }
  if (existing.material instanceof ShaderMaterial) {
    existing.material.dispose()
  }
  existing.removeFromParent()
}

function getVisibleSketchBounds(
  context: SketchSolveScenePluginContext
): Bounds | null {
  const camera = context.sceneInfra.camControls.camera
  const sketchGroup = context.sketchSolveGroup

  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  sketchGroup.updateMatrixWorld(true)

  const origin = sketchGroup.localToWorld(new Vector3(0, 0, 0))
  const normal = new Vector3(0, 0, 1)
    .transformDirection(sketchGroup.matrixWorld)
    .normalize()
  const sketchPlane = new Plane().setFromNormalAndCoplanarPoint(normal, origin)
  const localPoints: Point2d[] = []

  for (const [x, y] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const ray = createCameraRay(camera, x, y)
    const hit = ray.intersectPlane(sketchPlane, new Vector3())
    if (!hit) {
      return null
    }

    const local = sketchGroup.worldToLocal(hit.clone())
    localPoints.push({ x: local.x, y: local.y })
  }

  return boundsFromPoints(localPoints)
}

function createCameraRay(
  camera: SketchSolveScenePluginContext['sceneInfra']['camControls']['camera'],
  ndcX: number,
  ndcY: number
): Ray {
  if (camera instanceof OrthographicCamera) {
    const origin = new Vector3(ndcX, ndcY, -1).unproject(camera)
    const direction = camera.getWorldDirection(new Vector3()).normalize()
    return new Ray(origin, direction)
  }

  const origin = camera.getWorldPosition(new Vector3())
  const direction = new Vector3(ndcX, ndcY, 0.5)
    .unproject(camera)
    .sub(origin)
    .normalize()
  return new Ray(origin, direction)
}

function getSceneGraphBounds(
  sceneGraphDelta: SceneGraphDelta,
  sketchId: number
): Bounds {
  const objects = getCurrentSketchObjectsById(
    sceneGraphDelta.new_graph.objects,
    sketchId
  )
  const points: Point2d[] = []

  for (const object of objects) {
    const point = pointForObject(object)
    if (point) {
      points.push(point)
    }

    const arc = getArcCenterAndRadius(object, objects)
    if (arc) {
      points.push(
        { x: arc.center.x - arc.radius, y: arc.center.y - arc.radius },
        { x: arc.center.x + arc.radius, y: arc.center.y + arc.radius }
      )
    }
  }

  return boundsFromPoints(points)
}

function boundsFromPoints(points: Point2d[]): Bounds {
  if (!points.length) {
    return { minX: -10, minY: -10, maxX: 10, maxY: 10 }
  }

  const bounds = points.reduce(
    (acc, point) => ({
      minX: Math.min(acc.minX, point.x),
      minY: Math.min(acc.minY, point.y),
      maxX: Math.max(acc.maxX, point.x),
      maxY: Math.max(acc.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
  )
  const width = Math.max(bounds.maxX - bounds.minX, 1)
  const height = Math.max(bounds.maxY - bounds.minY, 1)
  const padding = Math.max(width, height) * 0.08

  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  }
}
