import type {
  ApiConstraint,
  ApiObject,
  SceneGraphDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import { KCLError } from '@src/lang/errors'
import type RustContext from '@src/lib/rustContext'
import {
  buildCircularSizeDimensionConstraintInput,
  buildSymmetricConstraintInput,
  buildTangentConstraintInput,
  getArcPoints,
  getLinePoints,
  isArcLikeSegment,
  isCircleSegment,
  isLineSegment,
  isOwnedLineSegment,
  isPointSegment,
  pointToCoords2d,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import type { SketchSolveSelectionId } from '@src/machines/sketchSolve/sketchSolveSelection'
import { getConstraintToolPreparedApply } from '@src/machines/sketchSolve/tools/constraintToolHelpers'
import type { ConstraintToolName } from '@src/machines/sketchSolve/tools/constraintToolModel'

const MAX_AXIS_RESIDUAL = 0.15
const MAX_EQUAL_SIZE_RESIDUAL = 0.08
const MAX_TANGENT_RESIDUAL = 0.08
const MAX_SYMMETRY_RESIDUAL = 0.08
const MAX_DIMENSION_RESIDUAL = 0.025
const MAX_PREVIEW_MOVEMENT = 0.05

type SuggestedToolName = Extract<
  ConstraintToolName,
  | 'horizontalConstraintTool'
  | 'verticalConstraintTool'
  | 'equalLengthConstraintTool'
>

export type ConstraintSuggestion = {
  label: string
  explanation: string
  payload: ApiConstraint
  score: number
  features: {
    normalizedResidual: number
    previewMovementRatio: number
    freePointFraction: number
  }
}

type Candidate = Omit<ConstraintSuggestion, 'features'> & {
  scale: number
  normalizedResidual: number
}
type Point = readonly [number, number]

export type SuggestionCheckEvent =
  | { type: 'candidate'; constraintType: ApiConstraint['type'] }
  | { type: 'solverRejected'; constraintType: ApiConstraint['type'] }
  | { type: 'geometryRejected'; constraintType: ApiConstraint['type'] }
  | { type: 'previewPassed'; constraintType: ApiConstraint['type'] }

function distance(first: readonly number[], second: readonly number[]) {
  return Math.hypot(first[0] - second[0], first[1] - second[1])
}

function selectedGeometryCanMove(
  selectedObjects: readonly ApiObject[],
  objects: readonly ApiObject[]
) {
  return selectedObjects.some((object) => {
    if (isPointSegment(object)) {
      return object.kind.segment.freedom === 'Free'
    }
    if (object.kind.type !== 'Segment') {
      return false
    }
    const segment = object.kind.segment
    if (
      segment.type !== 'Line' &&
      segment.type !== 'Arc' &&
      segment.type !== 'Circle'
    ) {
      return false
    }
    const pointIds =
      segment.type === 'Line'
        ? [segment.start, segment.end]
        : [segment.center, segment.start]
    return pointIds.some((pointId) => {
      const point = objects[pointId]
      return isPointSegment(point) && point.kind.segment.freedom === 'Free'
    })
  })
}

function sameIds(first: readonly number[], second: readonly number[]) {
  return (
    first.length === second.length && first.every((id) => second.includes(id))
  )
}

function hasEquivalentConstraint(
  constraint: ApiConstraint,
  sketchId: number,
  objects: readonly ApiObject[]
) {
  const sketch = objects[sketchId]
  if (sketch?.kind.type !== 'Sketch') {
    return false
  }
  return sketch.kind.constraints.some((constraintId) => {
    const existing = objects[constraintId]
    if (existing?.kind.type !== 'Constraint') {
      return false
    }
    const current = existing.kind.constraint
    if (current.type !== constraint.type) {
      return false
    }
    switch (constraint.type) {
      case 'Horizontal':
      case 'Vertical':
        if (!('line' in constraint)) {
          return false
        }
        if ('line' in current) {
          return current.line === constraint.line
        }
        if ('points' in current) {
          const line = objects[constraint.line]
          return (
            isLineSegment(line) &&
            sameIds(
              current.points.filter(
                (id): id is number => typeof id === 'number'
              ),
              [line.kind.segment.start, line.kind.segment.end]
            )
          )
        }
        return false
      case 'LinesEqualLength':
        return (
          current.type === 'LinesEqualLength' &&
          constraint.lines.every((id) => current.lines.includes(id))
        )
      case 'EqualRadius':
        return (
          current.type === 'EqualRadius' &&
          constraint.input.every((id) => current.input.includes(id))
        )
      case 'Tangent':
        return 'input' in current && sameIds(current.input, constraint.input)
      case 'Symmetric':
        return (
          current.type === 'Symmetric' &&
          current.axis === constraint.axis &&
          sameIds(current.input, constraint.input)
        )
      case 'Distance':
        return (
          current.type === 'Distance' &&
          sameIds(
            current.segments.filter(
              (id): id is number => typeof id === 'number'
            ),
            constraint.segments.filter(
              (id): id is number => typeof id === 'number'
            )
          )
        )
      case 'Radius':
      case 'Diameter':
        return 'arc' in current && current.arc === constraint.arc
      case 'Coincident':
      case 'HorizontalDistance':
      case 'VerticalDistance':
      case 'Midpoint':
      case 'Parallel':
      case 'Perpendicular':
      case 'Angle':
      case 'Fixed':
        return false
    }
  })
}

function makeCandidate(
  payload: ApiConstraint | null,
  label: string,
  explanation: string,
  residual: number,
  maximumResidual: number,
  scale: number,
  sketchId: number,
  objects: readonly ApiObject[]
): Candidate | null {
  if (
    !payload ||
    !Number.isFinite(residual) ||
    residual > maximumResidual ||
    scale <= 0 ||
    hasEquivalentConstraint(payload, sketchId, objects)
  ) {
    return null
  }
  return {
    label,
    explanation,
    payload,
    scale,
    normalizedResidual: residual / maximumResidual,
    score: 1 - residual / maximumResidual,
  }
}

function toolPayload(
  toolName: SuggestedToolName,
  selectionIds: readonly SketchSolveSelectionId[],
  objects: readonly ApiObject[]
) {
  const prepared = getConstraintToolPreparedApply(
    toolName,
    selectionIds,
    objects
  )
  return prepared?.payloads.length === 1 ? prepared.payload : null
}

function niceDimension(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  const exponent = Math.floor(Math.log10(value))
  const values = [exponent - 1, exponent, exponent + 1].flatMap((power) =>
    [1, 2, 2.5, 5].map((mantissa) =>
      Number((mantissa * 10 ** power).toPrecision(12))
    )
  )
  return values.reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
  )
}

function unitLabel(units: NumericSuffix) {
  const labels: Partial<Record<NumericSuffix, string>> = {
    Mm: 'mm',
    Cm: 'cm',
    M: 'm',
    Inch: 'in',
    Ft: 'ft',
    Yd: 'yd',
  }
  return labels[units] ? ` ${labels[units]}` : ''
}

function lineDimension(
  line: ApiObject,
  length: number,
  units: NumericSuffix
): ApiConstraint | null {
  if (!isLineSegment(line)) {
    return null
  }
  const target = niceDimension(length)
  if (target === null) {
    return null
  }
  return {
    type: 'Distance',
    distance: { value: target, units },
    segments: [line.kind.segment.start, line.kind.segment.end],
    source: { expr: target.toString(), is_literal: true },
  }
}

function tangentResidual(
  first: ApiObject,
  second: ApiObject,
  objects: readonly ApiObject[]
): { residual: number; scale: number } | null {
  const line = isLineSegment(first)
    ? first
    : isLineSegment(second)
      ? second
      : null
  const arc = isArcLikeSegment(first)
    ? first
    : isArcLikeSegment(second)
      ? second
      : null
  if (line && arc) {
    const linePoints = getLinePoints(line, [...objects])
    const arcPoints = getArcPoints(arc, [...objects])
    if (!linePoints || !arcPoints) {
      return null
    }
    const [start, end] = linePoints
    const length = distance(start, end)
    const radius = distance(arcPoints.center, arcPoints.start)
    if (length === 0 || radius === 0) {
      return null
    }
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const cx = arcPoints.center[0] - start[0]
    const cy = arcPoints.center[1] - start[1]
    const projection = (cx * dx + cy * dy) / (length * length)
    if (projection < -0.05 || projection > 1.05) {
      return null
    }
    const contact: Point = [
      start[0] + projection * dx,
      start[1] + projection * dy,
    ]
    if (
      !arcPoints.isCircle &&
      Math.min(
        distance(contact, arcPoints.start),
        distance(contact, arcPoints.end)
      ) /
        radius >
        0.15
    ) {
      return null
    }
    const centerDistance = Math.abs(cx * dy - cy * dx) / length
    return {
      residual: Math.abs(centerDistance - radius) / radius,
      scale: Math.max(length, radius),
    }
  }
  if (isCircleSegment(first) && isCircleSegment(second)) {
    const firstPoints = getArcPoints(first, [...objects])
    const secondPoints = getArcPoints(second, [...objects])
    if (!firstPoints || !secondPoints) {
      return null
    }
    const firstRadius = distance(firstPoints.center, firstPoints.start)
    const secondRadius = distance(secondPoints.center, secondPoints.start)
    const scale = Math.max(firstRadius, secondRadius)
    if (scale === 0) {
      return null
    }
    return {
      residual:
        Math.abs(
          distance(firstPoints.center, secondPoints.center) -
            firstRadius -
            secondRadius
        ) / scale,
      scale,
    }
  }
  return null
}

function mirrorAcrossLine(
  point: Point,
  start: Point,
  end: Point
): Point | null {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) {
    return null
  }
  const t =
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared
  return [
    2 * (start[0] + t * dx) - point[0],
    2 * (start[1] + t * dy) - point[1],
  ]
}

function symmetryResidual(
  selectedObjects: readonly ApiObject[],
  objects: readonly ApiObject[]
): { residual: number; scale: number } | null {
  const axis = selectedObjects.find(isLineSegment)
  const pair = selectedObjects.filter(
    (object) => isPointSegment(object) || isCircleSegment(object)
  )
  if (!axis || pair.length !== 2) {
    return null
  }
  const axisPoints = getLinePoints(axis, [...objects])
  if (!axisPoints) {
    return null
  }
  let first: Point
  let second: Point
  let radiusResidual = 0
  let radiusScale = 0
  if (pair.every(isPointSegment)) {
    first = pointToCoords2d(pair[0])
    second = pointToCoords2d(pair[1])
  } else if (pair.every(isCircleSegment)) {
    const firstPoints = getArcPoints(pair[0], [...objects])
    const secondPoints = getArcPoints(pair[1], [...objects])
    if (!firstPoints || !secondPoints) {
      return null
    }
    first = firstPoints.center
    second = secondPoints.center
    const firstRadius = distance(firstPoints.center, firstPoints.start)
    const secondRadius = distance(secondPoints.center, secondPoints.start)
    radiusScale = Math.max(firstRadius, secondRadius)
    radiusResidual =
      Math.abs(firstRadius - secondRadius) /
      Math.max(radiusScale, Number.EPSILON)
  } else {
    return null
  }
  const mirrored = mirrorAcrossLine(first, axisPoints[0], axisPoints[1])
  const scale = Math.max(distance(first, second), radiusScale)
  if (!mirrored || scale === 0) {
    return null
  }
  return {
    residual: Math.max(distance(mirrored, second) / scale, radiusResidual),
    scale,
  }
}

export function generateConstraintCandidates(
  selectionIds: readonly SketchSolveSelectionId[],
  sketchId: number,
  objects: readonly ApiObject[],
  units: NumericSuffix = 'Mm'
): Candidate[] {
  if (
    selectionIds.length === 0 ||
    selectionIds.length > 3 ||
    selectionIds.some((id) => typeof id !== 'number')
  ) {
    return []
  }
  const sketch = objects[sketchId]
  if (sketch?.kind.type !== 'Sketch') {
    return []
  }
  const activeSegmentIds = new Set(sketch.kind.segments)
  if (selectionIds.some((id) => !activeSegmentIds.has(id as number))) {
    return []
  }
  const selectedObjects = selectionIds.map((id) => objects[id as number])
  if (
    selectedObjects.some((object) => object === undefined) ||
    selectedObjects.some(isOwnedLineSegment) ||
    !selectedGeometryCanMove(selectedObjects, objects)
  ) {
    return []
  }
  if (
    selectedObjects.length === 3 &&
    !selectedGeometryCanMove(
      selectedObjects.filter((object) => !isLineSegment(object)),
      objects
    )
  ) {
    return []
  }
  const candidates: (Candidate | null)[] = []

  if (selectedObjects.length === 1) {
    const selected = selectedObjects[0]
    if (isLineSegment(selected)) {
      const points = getLinePoints(selected, [...objects])
      if (!points) {
        return []
      }
      const length = distance(points[0], points[1])
      if (length === 0) {
        return []
      }
      candidates.push(
        makeCandidate(
          toolPayload('horizontalConstraintTool', selectionIds, objects),
          'Make horizontal',
          'Line is nearly horizontal',
          Math.abs(points[1][1] - points[0][1]) / length,
          MAX_AXIS_RESIDUAL,
          length,
          sketchId,
          objects
        ),
        makeCandidate(
          toolPayload('verticalConstraintTool', selectionIds, objects),
          'Make vertical',
          'Line is nearly vertical',
          Math.abs(points[1][0] - points[0][0]) / length,
          MAX_AXIS_RESIDUAL,
          length,
          sketchId,
          objects
        )
      )
      const dimension = lineDimension(selected, length, units)
      if (dimension?.type === 'Distance') {
        candidates.push(
          makeCandidate(
            dimension,
            `Set length to ${dimension.distance.value}${unitLabel(units)}`,
            'Line length is near a simple dimension',
            Math.abs(length - dimension.distance.value) / length,
            MAX_DIMENSION_RESIDUAL,
            length,
            sketchId,
            objects
          )
        )
      }
    } else if (isArcLikeSegment(selected)) {
      const points = getArcPoints(selected, [...objects])
      if (!points) {
        return []
      }
      const radius = distance(points.center, points.start)
      const measured = points.isCircle ? radius * 2 : radius
      const target = niceDimension(measured)
      if (target !== null) {
        const dimension = buildCircularSizeDimensionConstraintInput({
          segment: selected,
          radius: points.isCircle ? target / 2 : target,
          units,
        })
        candidates.push(
          makeCandidate(
            dimension,
            `Set ${points.isCircle ? 'diameter' : 'radius'} to ${target}${unitLabel(units)}`,
            'Circular size is near a simple dimension',
            Math.abs(measured - target) / measured,
            MAX_DIMENSION_RESIDUAL,
            measured,
            sketchId,
            objects
          )
        )
      }
    }
  } else if (selectedObjects.length === 2) {
    if (selectedObjects.every(isLineSegment)) {
      const firstPoints = getLinePoints(selectedObjects[0], [...objects])
      const secondPoints = getLinePoints(selectedObjects[1], [...objects])
      if (firstPoints && secondPoints) {
        const firstSize = distance(firstPoints[0], firstPoints[1])
        const secondSize = distance(secondPoints[0], secondPoints[1])
        const scale = Math.max(firstSize, secondSize)
        candidates.push(
          makeCandidate(
            toolPayload('equalLengthConstraintTool', selectionIds, objects),
            'Make equal length',
            'Selected lines are nearly equal',
            Math.abs(firstSize - secondSize) / scale,
            MAX_EQUAL_SIZE_RESIDUAL,
            scale,
            sketchId,
            objects
          )
        )
      }
    } else if (selectedObjects.every(isArcLikeSegment)) {
      const firstPoints = getArcPoints(selectedObjects[0], [...objects])
      const secondPoints = getArcPoints(selectedObjects[1], [...objects])
      if (firstPoints && secondPoints) {
        const firstSize = distance(firstPoints.center, firstPoints.start)
        const secondSize = distance(secondPoints.center, secondPoints.start)
        const scale = Math.max(firstSize, secondSize)
        candidates.push(
          makeCandidate(
            toolPayload('equalLengthConstraintTool', selectionIds, objects),
            'Make equal radius',
            'Selected radii are nearly equal',
            Math.abs(firstSize - secondSize) / scale,
            MAX_EQUAL_SIZE_RESIDUAL,
            scale,
            sketchId,
            objects
          )
        )
      }
    }
    const tangent = tangentResidual(
      selectedObjects[0],
      selectedObjects[1],
      objects
    )
    if (tangent) {
      candidates.push(
        makeCandidate(
          buildTangentConstraintInput(selectionIds as number[], [...objects]),
          'Make tangent',
          'Selected geometry is nearly tangent',
          tangent.residual,
          MAX_TANGENT_RESIDUAL,
          tangent.scale,
          sketchId,
          objects
        )
      )
    }
  } else {
    const symmetry = symmetryResidual(selectedObjects, objects)
    if (symmetry) {
      candidates.push(
        makeCandidate(
          buildSymmetricConstraintInput(selectionIds as number[], [...objects]),
          'Make symmetric',
          'Selected pair nearly mirrors across the line',
          symmetry.residual,
          MAX_SYMMETRY_RESIDUAL,
          symmetry.scale,
          sketchId,
          objects
        )
      )
    }
  }
  return candidates.filter(
    (candidate): candidate is Candidate => candidate !== null
  )
}

function previewIsSafe(
  before: readonly ApiObject[],
  preview: SceneGraphDelta,
  scale: number
): number | null {
  if (preview.invalidates_ids) {
    return null
  }
  let maximumMovement = 0
  for (const object of before) {
    if (!isPointSegment(object)) {
      continue
    }
    const next = preview.new_graph.objects[object.id]
    if (!isPointSegment(next) || next.kind.segment.freedom === 'Conflict') {
      return null
    }
    maximumMovement = Math.max(
      maximumMovement,
      distance(pointToCoords2d(object), pointToCoords2d(next))
    )
  }
  const movementRatio = maximumMovement / scale
  return movementRatio <= MAX_PREVIEW_MOVEMENT ? movementRatio : null
}

function freePointFraction(
  selectionIds: readonly SketchSolveSelectionId[],
  objects: readonly ApiObject[]
) {
  const pointIds = new Set<number>()
  for (const selectedId of selectionIds) {
    if (typeof selectedId !== 'number') {
      continue
    }
    const selected = objects[selectedId]
    if (isPointSegment(selected)) {
      pointIds.add(selectedId)
    } else if (isLineSegment(selected)) {
      pointIds.add(selected.kind.segment.start)
      pointIds.add(selected.kind.segment.end)
    } else if (isArcLikeSegment(selected)) {
      pointIds.add(selected.kind.segment.center)
      pointIds.add(selected.kind.segment.start)
      if (selected.kind.segment.type === 'Arc') {
        pointIds.add(selected.kind.segment.end)
      }
    }
  }
  if (pointIds.size === 0) {
    return 0
  }
  let freePoints = 0
  for (const id of pointIds) {
    const point = objects[id]
    if (isPointSegment(point) && point.kind.segment.freedom === 'Free') {
      freePoints += 1
    }
  }
  return freePoints / pointIds.size
}

export async function rankConstraintSuggestions({
  selectionIds,
  sketchId,
  objects,
  rustContext,
  settings,
  units = 'Mm',
  onCheck,
  isCurrent,
}: {
  selectionIds: readonly SketchSolveSelectionId[]
  sketchId: number
  objects: readonly ApiObject[]
  rustContext: Pick<RustContext, 'previewConstraint'>
  settings: Parameters<RustContext['previewConstraint']>[3]
  units?: NumericSuffix
  onCheck?: (event: SuggestionCheckEvent) => void
  isCurrent?: () => boolean
}): Promise<ConstraintSuggestion[]> {
  const candidates = generateConstraintCandidates(
    selectionIds,
    sketchId,
    objects,
    units
  )
  const safeSuggestions: ConstraintSuggestion[] = []
  const selectionFreePointFraction = freePointFraction(selectionIds, objects)
  for (const candidate of candidates) {
    if (isCurrent && !isCurrent()) {
      return []
    }
    onCheck?.({
      type: 'candidate',
      constraintType: candidate.payload.type,
    })
    try {
      const preview = await rustContext.previewConstraint(
        0,
        sketchId,
        candidate.payload,
        settings
      )
      if (isCurrent && !isCurrent()) {
        return []
      }
      const previewMovementRatio = previewIsSafe(
        objects,
        preview,
        candidate.scale
      )
      if (previewMovementRatio === null) {
        onCheck?.({
          type: 'geometryRejected',
          constraintType: candidate.payload.type,
        })
        continue
      }
      safeSuggestions.push({
        label: candidate.label,
        explanation: candidate.explanation,
        payload: candidate.payload,
        score: candidate.score,
        features: {
          normalizedResidual: candidate.normalizedResidual,
          previewMovementRatio,
          freePointFraction: selectionFreePointFraction,
        },
      })
      onCheck?.({
        type: 'previewPassed',
        constraintType: candidate.payload.type,
      })
    } catch (error) {
      if (isCurrent && !isCurrent()) {
        return []
      }
      if (!(error instanceof KCLError)) {
        return Promise.reject(error)
      }
      onCheck?.({
        type: 'solverRejected',
        constraintType: candidate.payload.type,
      })
    }
  }
  return safeSuggestions.sort((first, second) => second.score - first.score)
}
