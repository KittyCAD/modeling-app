import type {
  ApiObject,
  SceneGraphDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SketchSolverTrace } from '@rust/kcl-lib/bindings/SketchSolverTrace'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'
import { isPointSegment } from '@src/machines/sketchSolve/constraints/constraintUtils'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import type { SketchSolveScenePluginContext } from '@src/registry/contracts/project'
import { isArray } from '@src/lib/utils'
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  type Material,
  type Object3D,
  Points,
  PointsMaterial,
} from 'three'

export const INITIAL_GUESS_UNDERLAY_OBJECT_NAME =
  'sketch-initial-guess-underlay'

const MIN_VISIBLE_DRIFT = 1.0e-6
const MAX_DASH_SEGMENTS = 24
const MIN_DASH_SEGMENTS = 4
const CIRCLE_SEGMENTS = 96

type Point2d = {
  x: number
  y: number
}

type Line2d = {
  start: Point2d
  end: Point2d
}

type Circle2d = {
  center: Point2d
  radius: number
}

type InitialGuessTraceValue = {
  id: number
  value: number
  sourceRange?: SourceRange
}

export type InitialGuessDrift = {
  pointId: number
  xGuessId: number
  yGuessId: number
  guess: Point2d
  resolved: Point2d
  distance: number
}

export type InitialGuessSupportGeometry =
  | {
      type: 'point'
      varIds: [number, number]
      initial: Point2d
      resolved: Point2d
      distance: number
    }
  | {
      type: 'line'
      varIds: [number, number, number, number]
      initial: Line2d
      resolved: Line2d
    }
  | {
      type: 'circle'
      varIds: [number, number, number]
      initial: Circle2d
      resolved: Circle2d
    }

export function updateInitialGuessUnderlay(
  context: SketchSolveScenePluginContext
): void {
  const drifts = buildInitialGuessDriftsForSceneGraph(
    context.sceneGraphDelta,
    context.sketchId
  )
  const supportGeometry = buildInitialGuessSupportGeometryForSceneGraph(
    context.sceneGraphDelta,
    context.sketchId
  )

  if (!drifts.length && !supportGeometry.length) {
    removeInitialGuessUnderlay(context.sketchSolveGroup)
    return
  }

  const underlay = getOrCreateInitialGuessUnderlay(context.sketchSolveGroup)
  updateInitialGuessUnderlayObjects(underlay, drifts, supportGeometry)
}

export function disposeInitialGuessUnderlay(
  context: SketchSolveScenePluginContext
): void {
  removeInitialGuessUnderlay(context.sketchSolveGroup)
}

export function buildInitialGuessDriftsForSceneGraph(
  sceneGraphDelta: SceneGraphDelta,
  sketchId: number
): InitialGuessDrift[] {
  const trace = latestTraceForSketch(
    sceneGraphDelta.exec_outcome.sketchSolverTraces,
    sketchId
  )
  if (!trace) {
    return []
  }

  const initialGuesses = initialGuessValues(trace)
  if (initialGuesses.length === 0) {
    return []
  }

  const pointSegments = currentSketchPointSegments(sceneGraphDelta, sketchId)
  const sourceBackedInitialGuesses = initialGuesses.filter(
    (guess) => guess.sourceRange !== undefined
  )
  const orderedInitialGuesses =
    sourceBackedInitialGuesses.length > 0
      ? sourceBackedInitialGuesses
      : initialGuesses
  const drifts: InitialGuessDrift[] = []

  for (let pointIndex = 0; pointIndex < pointSegments.length; pointIndex++) {
    const xGuess = orderedInitialGuesses[pointIndex * 2]
    const yGuess = orderedInitialGuesses[pointIndex * 2 + 1]
    if (xGuess === undefined || yGuess === undefined) {
      break
    }

    const point = pointSegments[pointIndex]
    const resolved = {
      x: point.kind.segment.position.x.value,
      y: point.kind.segment.position.y.value,
    }
    const guess = { x: xGuess.value, y: yGuess.value }
    const distance = pointDistance(guess, resolved)

    if (distance <= MIN_VISIBLE_DRIFT) {
      continue
    }

    drifts.push({
      pointId: point.id,
      xGuessId: xGuess.id,
      yGuessId: yGuess.id,
      guess,
      resolved,
      distance,
    })
  }

  return drifts
}

export function buildInitialGuessSupportGeometryForSceneGraph(
  sceneGraphDelta: SceneGraphDelta,
  sketchId: number
): InitialGuessSupportGeometry[] {
  const trace = latestTraceForSketch(
    sceneGraphDelta.exec_outcome.sketchSolverTraces,
    sketchId
  )
  if (!trace) {
    return []
  }

  return trace.items.flatMap((item) => {
    if (item.kind !== 'supportGeometry') {
      return []
    }
    const supportGeometry = parseSupportGeometryItem(item.detail)
    return supportGeometry ? [supportGeometry] : []
  })
}

function latestTraceForSketch(
  traces: readonly SketchSolverTrace[],
  sketchId: number
): SketchSolverTrace | null {
  for (let index = traces.length - 1; index >= 0; index--) {
    const trace = traces[index]
    if (trace?.sketchId === sketchId) {
      return trace
    }
  }

  return null
}

function initialGuessValues(
  trace: SketchSolverTrace
): InitialGuessTraceValue[] {
  const values: InitialGuessTraceValue[] = []

  for (const item of trace.items) {
    if (item.kind !== 'initialGuess') {
      continue
    }

    const id = item.label.match(/^guess\s+(\d+)$/)?.[1]
    const value = Number.parseFloat(item.detail.trim())
    if (id === undefined || !Number.isFinite(value)) {
      continue
    }

    values.push({
      id: Number.parseInt(id, 10),
      value,
      ...(item.sourceRange === undefined
        ? {}
        : { sourceRange: item.sourceRange }),
    })
  }

  return values.sort((a, b) => a.id - b.id)
}

function parseSupportGeometryItem(
  detail: string
): InitialGuessSupportGeometry | null {
  const lines = new Map(
    detail
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, ...values] = line.split(/\s+/)
        return [key, values] as const
      })
  )
  const type = lines.get('type')?.[0]
  const varIds = parseNumbers(lines.get('vars'))
  const initial = parseNumbers(lines.get('initial'))
  const resolved = parseNumbers(lines.get('resolved'))

  if (type === 'point') {
    if (varIds.length !== 2 || initial.length !== 2 || resolved.length !== 2) {
      return null
    }
    const initialPoint = { x: initial[0], y: initial[1] }
    const resolvedPoint = { x: resolved[0], y: resolved[1] }
    return {
      type,
      varIds: [varIds[0], varIds[1]],
      initial: initialPoint,
      resolved: resolvedPoint,
      distance: pointDistance(initialPoint, resolvedPoint),
    }
  }

  if (type === 'line') {
    if (varIds.length !== 4 || initial.length !== 4 || resolved.length !== 4) {
      return null
    }
    return {
      type,
      varIds: [varIds[0], varIds[1], varIds[2], varIds[3]],
      initial: {
        start: { x: initial[0], y: initial[1] },
        end: { x: initial[2], y: initial[3] },
      },
      resolved: {
        start: { x: resolved[0], y: resolved[1] },
        end: { x: resolved[2], y: resolved[3] },
      },
    }
  }

  if (type === 'circle') {
    if (varIds.length !== 3 || initial.length !== 3 || resolved.length !== 3) {
      return null
    }
    return {
      type,
      varIds: [varIds[0], varIds[1], varIds[2]],
      initial: {
        center: { x: initial[0], y: initial[1] },
        radius: Math.abs(initial[2]),
      },
      resolved: {
        center: { x: resolved[0], y: resolved[1] },
        radius: Math.abs(resolved[2]),
      },
    }
  }

  return null
}

function parseNumbers(values: string[] | undefined): number[] {
  if (!values) {
    return []
  }

  const numbers = values.map((value) => Number.parseFloat(value))
  return numbers.every(Number.isFinite) ? numbers : []
}

function currentSketchPointSegments(
  sceneGraphDelta: SceneGraphDelta,
  sketchId: number
) {
  const objects = getCurrentSketchObjectsById(
    sceneGraphDelta.new_graph.objects,
    sketchId
  )
  const points: Array<
    ApiObject & { kind: { type: 'Segment'; segment: { type: 'Point' } } }
  > = []

  for (const object of objects) {
    if (isPointSegment(object)) {
      points.push(object)
    }
  }

  return points
}

function getOrCreateInitialGuessUnderlay(group: Group): Group {
  const existing = group.getObjectByName(INITIAL_GUESS_UNDERLAY_OBJECT_NAME)
  if (existing instanceof Group) {
    return existing
  }

  if (existing) {
    disposeObjectTree(existing)
    existing.removeFromParent()
  }

  const underlay = new Group()
  underlay.name = INITIAL_GUESS_UNDERLAY_OBJECT_NAME
  underlay.renderOrder = 1000
  underlay.layers.set(SKETCH_LAYER)
  group.add(underlay)

  return underlay
}

function updateInitialGuessUnderlayObjects(
  underlay: Group,
  drifts: InitialGuessDrift[],
  supportGeometry: InitialGuessSupportGeometry[]
) {
  clearUnderlayChildren(underlay)

  const linePositions: number[] = []
  const pointPositions: number[] = []
  const supportInitialLinePositions: number[] = []
  const supportResolvedLinePositions: number[] = []
  const supportDriftLinePositions: number[] = []
  const supportInitialPointPositions: number[] = []
  const supportResolvedPointPositions: number[] = []

  for (const support of supportGeometry) {
    if (support.type === 'point') {
      supportInitialPointPositions.push(
        support.initial.x,
        support.initial.y,
        0.01
      )
      supportResolvedPointPositions.push(
        support.resolved.x,
        support.resolved.y,
        0.011
      )
      appendDashedLine(
        supportDriftLinePositions,
        support.initial,
        support.resolved,
        0.01
      )
      continue
    }

    if (support.type === 'line') {
      appendDashedLine(
        supportInitialLinePositions,
        support.initial.start,
        support.initial.end,
        0.01
      )
      appendSolidLine(
        supportResolvedLinePositions,
        support.resolved.start,
        support.resolved.end,
        0.011
      )
      continue
    }

    appendCircleSegments(
      supportInitialLinePositions,
      support.initial.center,
      support.initial.radius,
      true,
      0.01
    )
    appendCircleSegments(
      supportResolvedLinePositions,
      support.resolved.center,
      support.resolved.radius,
      false,
      0.011
    )
  }

  for (const drift of drifts) {
    appendDashedLine(linePositions, drift.guess, drift.resolved)
    pointPositions.push(drift.guess.x, drift.guess.y, 0.02)
  }

  addLineSegments(underlay, supportInitialLinePositions, 0x19c7ff, 0.32, 998)
  addLineSegments(underlay, supportResolvedLinePositions, 0x19c7ff, 0.72, 999)
  addLineSegments(underlay, supportDriftLinePositions, 0x19c7ff, 0.45, 999)
  addPoints(underlay, supportInitialPointPositions, 0x19c7ff, 0.5, 5, 999)
  addPoints(underlay, supportResolvedPointPositions, 0x19c7ff, 0.9, 6, 1000)
  addLineSegments(underlay, linePositions, 0xff4fd8, 0.78, 1000)

  addPoints(underlay, pointPositions, 0xff4fd8, 0.95, 7, 1001)
}

function addLineSegments(
  underlay: Group,
  positions: number[],
  color: number,
  opacity: number,
  renderOrder: number
) {
  if (positions.length === 0) {
    return
  }

  const lineGeometry = new BufferGeometry()
  lineGeometry.setAttribute(
    'position',
    new Float32BufferAttribute(positions, 3)
  )
  const lines = new LineSegments(
    lineGeometry,
    new LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
    })
  )
  lines.renderOrder = renderOrder
  lines.layers.set(SKETCH_LAYER)
  lines.raycast = () => undefined
  underlay.add(lines)
}

function addPoints(
  underlay: Group,
  positions: number[],
  color: number,
  opacity: number,
  size: number,
  renderOrder: number
) {
  if (positions.length === 0) {
    return
  }

  const pointGeometry = new BufferGeometry()
  pointGeometry.setAttribute(
    'position',
    new Float32BufferAttribute(positions, 3)
  )
  const points = new Points(
    pointGeometry,
    new PointsMaterial({
      color,
      transparent: true,
      opacity,
      size,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
    })
  )
  points.renderOrder = renderOrder
  points.layers.set(SKETCH_LAYER)
  points.raycast = () => undefined
  underlay.add(points)
}

function appendSolidLine(
  positions: number[],
  start: Point2d,
  end: Point2d,
  z = 0.02
) {
  if (pointDistance(start, end) <= MIN_VISIBLE_DRIFT) {
    return
  }

  positions.push(start.x, start.y, z, end.x, end.y, z)
}

function appendDashedLine(
  positions: number[],
  start: Point2d,
  end: Point2d,
  z = 0.02
) {
  const distance = pointDistance(start, end)
  if (distance <= MIN_VISIBLE_DRIFT) {
    return
  }

  const dashCount = Math.min(
    MAX_DASH_SEGMENTS,
    Math.max(MIN_DASH_SEGMENTS, Math.ceil(distance / 2))
  )

  for (let dashIndex = 0; dashIndex < dashCount; dashIndex++) {
    const startT = dashIndex / dashCount
    const endT = Math.min(startT + 0.5 / dashCount, 1)
    positions.push(
      lerp(start.x, end.x, startT),
      lerp(start.y, end.y, startT),
      z,
      lerp(start.x, end.x, endT),
      lerp(start.y, end.y, endT),
      z
    )
  }
}

function appendCircleSegments(
  positions: number[],
  center: Point2d,
  radius: number,
  dashed: boolean,
  z: number
) {
  if (!Number.isFinite(radius) || radius <= MIN_VISIBLE_DRIFT) {
    return
  }

  for (let index = 0; index < CIRCLE_SEGMENTS; index++) {
    if (dashed && index % 2 === 1) {
      continue
    }

    const startAngle = (index / CIRCLE_SEGMENTS) * Math.PI * 2
    const endAngle = ((index + 1) / CIRCLE_SEGMENTS) * Math.PI * 2
    positions.push(
      center.x + Math.cos(startAngle) * radius,
      center.y + Math.sin(startAngle) * radius,
      z,
      center.x + Math.cos(endAngle) * radius,
      center.y + Math.sin(endAngle) * radius,
      z
    )
  }
}

function clearUnderlayChildren(underlay: Group) {
  for (const child of [...underlay.children]) {
    disposeObjectTree(child)
    child.removeFromParent()
  }
}

function removeInitialGuessUnderlay(group: Group) {
  const existing = group.getObjectByName(INITIAL_GUESS_UNDERLAY_OBJECT_NAME)
  if (!existing) {
    return
  }

  disposeObjectTree(existing)
  existing.removeFromParent()
}

function disposeObjectTree(object: Object3D) {
  object.traverse((child) => {
    const disposable = child as Object3D & {
      geometry?: BufferGeometry
      material?: Material | Material[]
    }
    disposable.geometry?.dispose()
    const materials = isArray(disposable.material)
      ? disposable.material
      : [disposable.material]
    for (const material of materials) {
      material?.dispose()
    }
  })
}

function pointDistance(a: Point2d, b: Point2d): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
