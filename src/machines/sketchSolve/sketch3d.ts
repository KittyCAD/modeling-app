import type { Segment3d } from '@rust/kcl-lib/bindings/FrontendApi'
import type { CallExpressionKw } from '@rust/kcl-lib/bindings/CallExpressionKw'
import type { Expr } from '@rust/kcl-lib/bindings/Expr'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { SketchBlock } from '@rust/kcl-lib/bindings/SketchBlock'
import { isArray } from '@src/lib/utils'
import type { CameraControls } from '@src/clientSideScene/CameraControls'
import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'

/** Engine zoom-to-fit cannot see geometry rendered only in the client scene. */
export function fitSketch3dView(
  segments: Segment3d[],
  controls: Pick<CameraControls, 'camera' | 'target' | 'update'>
): boolean {
  const points = segments.flatMap(sampleSegment3d)
  if (!points.length) return false
  const bounds = new Box3().setFromPoints(points)
  const center = bounds.getCenter(new Vector3())
  const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 1)
  const camera = controls.camera
  const direction = camera.position.clone().sub(controls.target).normalize()
  if (direction.lengthSq() === 0) direction.set(1, -1, 1).normalize()
  let distance = radius * 3
  if (camera instanceof PerspectiveCamera) {
    const halfVertical = (camera.fov * Math.PI) / 360
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect)
    distance = (radius * 1.2) / Math.sin(Math.min(halfVertical, halfHorizontal))
  } else if (camera instanceof OrthographicCamera) {
    camera.zoom =
      Math.min(camera.right - camera.left, camera.top - camera.bottom) /
      (radius * 2.4)
  }
  controls.target.copy(center)
  camera.position.copy(center).addScaledVector(direction, distance)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  controls.update(true)
  return true
}

/** Sample circular geometry in its own plane, preserving the authored traversal. */
export function sampleSegment3d(segment: Segment3d): Vector3[] {
  const points = segment.points.map((p) => new Vector3(...p))
  if (segment.kind === 'point' || segment.kind === 'line') return points
  const center = points.at(-1)
  const start = points[0]
  if (!center || !start || !segment.normal) return []
  const normal = new Vector3(...segment.normal).normalize()
  const radial = start.clone().sub(center)
  const radius = radial.length()
  const u = radial.normalize()
  const v = normal.clone().cross(u)
  let angle = Math.PI * 2
  if (segment.kind === 'arc' && points[1]) {
    const end = points[1].clone().sub(center)
    angle = Math.atan2(end.dot(v), end.dot(u))
    if (segment.clockwise) {
      if (angle >= 0) angle -= Math.PI * 2
    } else if (angle <= 0) angle += Math.PI * 2
  }
  return Array.from({ length: 97 }, (_, i) => {
    const theta = (angle * i) / 96
    return center
      .clone()
      .addScaledVector(u, radius * Math.cos(theta))
      .addScaledVector(v, radius * Math.sin(theta))
  })
}

export const sketch3dPlanes = {
  XY: { normal: [0, 0, 1], axis: 2 },
  XZ: { normal: [0, -1, 0], axis: 1 },
  YZ: { normal: [1, 0, 0], axis: 0 },
} as const

export type Sketch3dTool = 'point' | 'line' | 'arc' | 'circle'
export type Position3d = [number, number, number]

/** Delete dependent statements too, so constructors cannot retain dangling references. */
export function sketch3dDeleteRanges(
  block: Node<SketchBlock>,
  labels: string[]
): [number, number][] {
  const deletedNames = new Set(labels)
  const removed = new Set<number>()
  function references(value: unknown): boolean {
    if (isArray(value)) return value.some(references)
    if (!value || typeof value !== 'object') return false
    const object = value as Record<string, unknown>
    if (
      object.type === 'Name' &&
      object.name &&
      typeof object.name === 'object' &&
      'name' in object.name &&
      typeof object.name.name === 'string' &&
      deletedNames.has(object.name.name) &&
      !object.abs_path &&
      isArray(object.path) &&
      object.path.length === 0
    )
      return true
    return Object.values(object).some(references)
  }
  let changed = true
  while (changed) {
    changed = false
    block.body.items.forEach((item, index) => {
      if (removed.has(index)) return
      const name =
        item.type === 'VariableDeclaration' ? item.declaration.id.name : null
      if ((name && deletedNames.has(name)) || references(item)) {
        removed.add(index)
        if (name) deletedNames.add(name)
        changed = true
      }
    })
  }
  return [...removed].map((i) => [
    block.body.items[i].start,
    block.body.items[i].end,
  ])
}

export function sketch3dConstraintStatement(
  name: string,
  refs: string[],
  segments: Segment3d[],
  value: number
): string | Error {
  const kinds = refs.map((ref) => {
    if (ref === 'ORIGIN') return 'point'
    const whole = segments.find((s) => s.label === ref)
    if (whole) return whole.kind
    const dot = ref.lastIndexOf('.')
    const parent = segments.find((s) => s.label === ref.slice(0, dot))
    const member = ref.slice(dot + 1)
    if (
      parent &&
      ((member === 'start' &&
        ['line', 'arc', 'circle'].includes(parent.kind)) ||
        (member === 'end' && ['line', 'arc'].includes(parent.kind)) ||
        (member === 'center' && ['arc', 'circle'].includes(parent.kind)))
    )
      return 'point'
    return 'invalid'
  })
  if (!refs.length || kinds.includes('invalid'))
    return new Error('Select geometry or points in this sketch.')
  const points = kinds.every((k) => k === 'point')
  const lines = kinds.every((k) => k === 'line')
  const circular = kinds.every((k) => k === 'arc' || k === 'circle')
  const pair = refs.length === 2
  const input = `[${refs.join(', ')}]`
  if (['radius', 'diameter'].includes(name)) {
    if (refs.length !== 1 || !circular)
      return new Error('Select one arc or circle.')
    if (!Number.isFinite(value) || value <= 0)
      return new Error('Enter a positive radius or diameter.')
    return `${name}(${refs[0]}) == ${value}mm`
  }
  if (
    [
      'distance',
      'horizontalDistance',
      'verticalDistance',
      'depthDistance',
      'angle',
    ].includes(name)
  ) {
    const pointLine =
      name === 'distance' && kinds.includes('point') && kinds.includes('line')
    if (!pair || !(name === 'angle' ? lines : points || pointLine))
      return new Error(
        name === 'angle'
          ? 'Select two lines.'
          : 'Select two points, or a point and line for distance.'
      )
    if (
      !Number.isFinite(value) ||
      (name === 'distance' && value < 0) ||
      (name === 'angle' && (value < 0 || value > 180))
    )
      return new Error('Enter a valid dimension.')
    return `${name}(${input}) == ${value}${name === 'angle' ? 'deg' : 'mm'}`
  }
  if (['horizontal', 'vertical', 'depth'].includes(name)) {
    if (!((refs.length === 1 && lines) || (pair && points)))
      return new Error('Select a line or two points.')
    return `${name}(${refs.length === 1 ? refs[0] : input})`
  }
  if (name === 'midpoint') {
    if (!pair || !['line', 'arc'].includes(kinds[0]) || kinds[1] !== 'point')
      return new Error('Select a line or arc, then a point.')
    return `midpoint(${refs[0]}, point = ${refs[1]})`
  }
  if (name === 'symmetric') {
    if (refs.length !== 3 || kinds[0] !== kinds[1] || kinds[2] !== 'line')
      return new Error('Select matching geometry, then an axis line.')
    return `symmetric([${refs[0]}, ${refs[1]}], axis = ${refs[2]})`
  }
  if (name === 'tangent') {
    if (
      !pair ||
      !kinds.every((k) => ['line', 'arc', 'circle'].includes(k)) ||
      lines
    )
      return new Error('Select two curves, including an arc or circle.')
  } else if (['equalLength', 'parallel', 'perpendicular'].includes(name)) {
    if (refs.length < 2 || !lines || (name === 'perpendicular' && !pair))
      return new Error('Select two or more lines.')
  } else if (name === 'equalRadius') {
    if (refs.length < 2 || !circular)
      return new Error('Select two or more arcs or circles.')
  } else if (['coincident', 'fixed'].includes(name)) {
    if (
      refs.length < 2 ||
      (!points && !(pair && (kinds.includes('point') || lines)))
    )
      return new Error('Select points or a point and curve.')
  } else return new Error('Choose a supported constraint.')
  return `${name}(${input})`
}

export function sketch3dConstructor(
  tool: Sketch3dTool,
  points: Position3d[],
  normal: readonly number[],
  construction: boolean,
  clockwise = false,
  variables?: boolean[][]
): string | Error {
  const count = tool === 'point' ? 1 : tool === 'arc' ? 3 : 2
  if (
    points.length !== count ||
    points.some((p) => p.length !== 3 || p.some((n) => !Number.isFinite(n)))
  )
    return new Error('Enter three finite coordinates for every point.')
  const p = (point: Position3d, index: number) =>
    `[${point.map((n, axis) => `${variables?.[index]?.[axis] === false ? '' : 'var '}${n}mm`).join(', ')}]`
  const common = construction && tool !== 'point' ? ', construction = true' : ''
  if (tool === 'point') return `point(at = ${p(points[0], 0)})`
  if (tool === 'line')
    return `line(start = ${p(points[0], 0)}, end = ${p(points[1], 1)}${common})`
  if (
    normal.length !== 3 ||
    normal.some((n) => !Number.isFinite(n)) ||
    Math.hypot(...normal) < 1e-10
  )
    return new Error('Enter a nonzero normal for the circular plane.')
  const orientation = `normal = [${normal.join(', ')}]`
  if (tool === 'circle')
    return `circle(center = ${p(points[0], 0)}, start = ${p(points[1], 1)}, ${orientation}${common})`
  return `arc(center = ${p(points[0], 0)}, start = ${p(points[1], 1)}, end = ${p(points[2], 2)}, ${orientation}${clockwise ? ', direction = CW' : ''}${common})`
}

/** Keep fixed literal coordinates fixed; computed coordinates are edited in code. */
export function sketch3dVariableMask(
  call: CallExpressionKw,
  tool: Sketch3dTool
): boolean[][] | Error {
  const keys =
    tool === 'point'
      ? ['at']
      : tool === 'line'
        ? ['start', 'end']
        : tool === 'arc'
          ? ['center', 'start', 'end']
          : ['center', 'start']
  const numeric = (expr: Expr): boolean =>
    (expr.type === 'Literal' && typeof expr.value === 'object') ||
    (expr.type === 'UnaryExpression' &&
      expr.operator === '-' &&
      expr.argument.type === 'Literal' &&
      typeof expr.argument.value === 'object')
  const masks: boolean[][] = []
  for (const key of keys) {
    const arg = call.arguments.find((arg) => arg.label?.name === key)?.arg
    if (
      arg?.type !== 'ArrayExpression' ||
      arg.elements.length !== 3 ||
      arg.elements.some((e) => e.type !== 'SketchVar' && !numeric(e))
    )
      return new Error(
        'Edit geometry with coordinate expressions in the code editor.'
      )
    masks.push(arg.elements.map((e) => e.type === 'SketchVar'))
  }
  for (const arg of call.arguments) {
    if (
      arg.label?.name === 'normal' &&
      (arg.arg.type !== 'ArrayExpression' ||
        arg.arg.elements.some((e) => !numeric(e)))
    )
      return new Error(
        'Edit geometry with a normal expression in the code editor.'
      )
    if (
      arg.label?.name === 'construction' &&
      (arg.arg.type !== 'Literal' || typeof arg.arg.value !== 'boolean')
    )
      return new Error(
        'Edit geometry with a construction expression in the code editor.'
      )
    if (
      arg.label?.name === 'direction' &&
      arg.arg.type !== 'Literal' &&
      !(
        arg.arg.type === 'Name' &&
        !arg.arg.abs_path &&
        arg.arg.path.length === 0 &&
        ['CW', 'CCW'].includes(arg.arg.name.name)
      )
    )
      return new Error(
        'Edit geometry with a direction expression in the code editor.'
      )
  }
  return masks
}
