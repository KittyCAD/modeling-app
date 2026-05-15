import type {
  ApiObject,
  SceneGraphDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SketchSolverTrace } from '@rust/kcl-lib/bindings/SketchSolverTrace'
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

type Point2d = {
  x: number
  y: number
}

export type InitialGuessDrift = {
  pointId: number
  xGuessId: number
  yGuessId: number
  guess: Point2d
  resolved: Point2d
  distance: number
}

export function updateInitialGuessUnderlay(
  context: SketchSolveScenePluginContext
): void {
  const drifts = buildInitialGuessDriftsForSceneGraph(
    context.sceneGraphDelta,
    context.sketchId
  )

  if (!drifts.length) {
    removeInitialGuessUnderlay(context.sketchSolveGroup)
    return
  }

  const underlay = getOrCreateInitialGuessUnderlay(context.sketchSolveGroup)
  updateInitialGuessUnderlayObjects(underlay, drifts)
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

  const initialGuesses = initialGuessValuesById(trace)
  if (initialGuesses.size === 0) {
    return []
  }

  const pointSegments = currentSketchPointSegments(sceneGraphDelta, sketchId)
  const guessIds = [...initialGuesses.keys()].sort((a, b) => a - b)
  const drifts: InitialGuessDrift[] = []

  for (let pointIndex = 0; pointIndex < pointSegments.length; pointIndex++) {
    const xGuessId = guessIds[pointIndex * 2]
    const yGuessId = guessIds[pointIndex * 2 + 1]
    if (xGuessId === undefined || yGuessId === undefined) {
      break
    }

    const guessX = initialGuesses.get(xGuessId)
    const guessY = initialGuesses.get(yGuessId)
    if (guessX === undefined || guessY === undefined) {
      continue
    }

    const point = pointSegments[pointIndex]
    const resolved = {
      x: point.kind.segment.position.x.value,
      y: point.kind.segment.position.y.value,
    }
    const guess = { x: guessX, y: guessY }
    const distance = pointDistance(guess, resolved)

    if (distance <= MIN_VISIBLE_DRIFT) {
      continue
    }

    drifts.push({
      pointId: point.id,
      xGuessId,
      yGuessId,
      guess,
      resolved,
      distance,
    })
  }

  return drifts
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

function initialGuessValuesById(trace: SketchSolverTrace): Map<number, number> {
  const values = new Map<number, number>()

  for (const item of trace.items) {
    if (item.kind !== 'initialGuess') {
      continue
    }

    const id = item.label.match(/^guess\s+(\d+)$/)?.[1]
    const value = Number.parseFloat(item.detail.trim())
    if (id === undefined || !Number.isFinite(value)) {
      continue
    }

    values.set(Number.parseInt(id, 10), value)
  }

  return values
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
  drifts: InitialGuessDrift[]
) {
  clearUnderlayChildren(underlay)

  const linePositions: number[] = []
  const pointPositions: number[] = []

  for (const drift of drifts) {
    appendDashedLine(linePositions, drift.guess, drift.resolved)
    pointPositions.push(drift.guess.x, drift.guess.y, 0.02)
  }

  if (linePositions.length > 0) {
    const lineGeometry = new BufferGeometry()
    lineGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(linePositions, 3)
    )
    const lines = new LineSegments(
      lineGeometry,
      new LineBasicMaterial({
        color: 0xff4fd8,
        transparent: true,
        opacity: 0.78,
        depthTest: false,
        depthWrite: false,
      })
    )
    lines.renderOrder = 1000
    lines.layers.set(SKETCH_LAYER)
    lines.raycast = () => undefined
    underlay.add(lines)
  }

  if (pointPositions.length > 0) {
    const pointGeometry = new BufferGeometry()
    pointGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(pointPositions, 3)
    )
    const points = new Points(
      pointGeometry,
      new PointsMaterial({
        color: 0xff4fd8,
        transparent: true,
        opacity: 0.95,
        size: 7,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
      })
    )
    points.renderOrder = 1001
    points.layers.set(SKETCH_LAYER)
    points.raycast = () => undefined
    underlay.add(points)
  }
}

function appendDashedLine(positions: number[], start: Point2d, end: Point2d) {
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
      0.02,
      lerp(start.x, end.x, endT),
      lerp(start.y, end.y, endT),
      0.02
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
