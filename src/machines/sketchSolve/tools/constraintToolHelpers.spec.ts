import { describe, expect, it } from 'vitest'

import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { ORIGIN_TARGET } from '@src/machines/sketchSolve/sketchSolveSelection'
import {
  getConstraintToolPreparedApply,
  normalizeConstraintToolSelection,
  resolveConstraintToolClickAction,
  resolveConstraintToolSelectionAction,
} from '@src/machines/sketchSolve/tools/constraintToolHelpers'
import {
  createArcApiObject,
  createCircleApiObject,
  createLineApiObject,
  createPointApiObject,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

function createObjectsArray(objects: ApiObject[]) {
  const objectsArray: ApiObject[] = []

  for (const object of objects) {
    objectsArray[object.id] = object
  }

  return objectsArray
}

function createConstraintApiObject({
  id,
  type,
}: {
  id: number
  type: ApiConstraint['type']
}): ApiObject {
  const constraint: ApiConstraint =
    type === 'Horizontal'
      ? { type: 'Horizontal', line: 3 }
      : {
          type: 'Distance',
          points: [1, 2],
          distance: { value: 5, units: 'Mm' },
          source: { expr: '5', is_literal: true },
        }

  return {
    id,
    kind: {
      type: 'Constraint',
      constraint,
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

describe('constraintToolHelpers', () => {
  it('normalizes away incompatible selections when a tool is equipped', () => {
    const point = createPointApiObject({ id: 1 })
    const otherPoint = createPointApiObject({ id: 2 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const dimension = createConstraintApiObject({ id: 20, type: 'Distance' })
    const objects = createObjectsArray([point, otherPoint, line, dimension])

    const normalizedLine = normalizeConstraintToolSelection(
      'horizontalConstraintTool',
      [20, 3],
      objects
    )
    expect(normalizedLine.selectionIds).toEqual([3])
    expect(normalizedLine.status).toBe('complete')

    const normalizedPointPair = normalizeConstraintToolSelection(
      'horizontalConstraintTool',
      [1, 20, ORIGIN_TARGET],
      objects
    )
    expect(normalizedPointPair.selectionIds).toEqual([1, ORIGIN_TARGET])
    expect(normalizedPointPair.status).toBe('complete')
  })

  it('prepares immediate one-shot apply only when the current selection is valid as-is', () => {
    const point = createPointApiObject({ id: 1 })
    const otherPoint = createPointApiObject({ id: 2 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const dimension = createConstraintApiObject({ id: 20, type: 'Distance' })
    const objects = createObjectsArray([point, otherPoint, line, dimension])

    const validApply = getConstraintToolPreparedApply(
      'horizontalConstraintTool',
      [3],
      objects
    )
    expect(validApply?.payload).toEqual({
      type: 'Horizontal',
      line: 3,
    })

    const invalidApply = getConstraintToolPreparedApply(
      'horizontalConstraintTool',
      [20, 3],
      objects
    )
    expect(invalidApply).toBeNull()
  })

  it('prepares coincident payloads while preserving ORIGIN order', () => {
    const point = createPointApiObject({ id: 1 })
    const objects = createObjectsArray([point])

    const apply = getConstraintToolPreparedApply(
      'coincidentConstraintTool',
      [ORIGIN_TARGET, 1],
      objects
    )

    expect(apply?.payload).toEqual({
      type: 'Coincident',
      segments: ['ORIGIN', 1],
    })
  })

  it('prepares grouped coincident payloads from multiple point selections', () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const objects = createObjectsArray([pointA, pointB, pointC])

    const apply = getConstraintToolPreparedApply(
      'coincidentConstraintTool',
      [1, 2, 3],
      objects
    )

    expect(apply?.payload).toEqual({
      type: 'Coincident',
      segments: [1, 2, 3],
    })
  })

  it('prepares midpoint payloads from point-line selections', () => {
    const point = createPointApiObject({ id: 1 })
    const lineStart = createPointApiObject({ id: 2 })
    const lineEnd = createPointApiObject({ id: 3 })
    const line = createLineApiObject({ id: 10, start: 2, end: 3 })
    const objects = createObjectsArray([point, lineStart, lineEnd, line])

    const apply = getConstraintToolPreparedApply(
      'midpointConstraintTool',
      [1, 10],
      objects
    )

    expect(apply?.payload).toEqual({
      type: 'Midpoint',
      point: 1,
      segment: 10,
    })
  })

  it('prepares midpoint payloads from point-arc selections', () => {
    const point = createPointApiObject({ id: 1 })
    const center = createPointApiObject({ id: 2 })
    const arcStart = createPointApiObject({ id: 3 })
    const arcEnd = createPointApiObject({ id: 4 })
    const arc = createArcApiObject({ id: 10, center: 2, start: 3, end: 4 })
    const objects = createObjectsArray([point, center, arcStart, arcEnd, arc])

    const pointArcApply = getConstraintToolPreparedApply(
      'midpointConstraintTool',
      [1, 10],
      objects
    )
    expect(pointArcApply?.payload).toEqual({
      type: 'Midpoint',
      point: 1,
      segment: 10,
    })

    const arcPointApply = getConstraintToolPreparedApply(
      'midpointConstraintTool',
      [10, 1],
      objects
    )
    expect(arcPointApply?.payload).toEqual({
      type: 'Midpoint',
      point: 1,
      segment: 10,
    })
  })

  it('prepares midpoint payloads from origin-segment selections', () => {
    const lineStart = createPointApiObject({ id: 1 })
    const lineEnd = createPointApiObject({ id: 2 })
    const line = createLineApiObject({ id: 10, start: 1, end: 2 })
    const center = createPointApiObject({ id: 3 })
    const arcStart = createPointApiObject({ id: 4 })
    const arcEnd = createPointApiObject({ id: 5 })
    const arc = createArcApiObject({ id: 11, center: 3, start: 4, end: 5 })
    const objects = createObjectsArray([
      lineStart,
      lineEnd,
      line,
      center,
      arcStart,
      arcEnd,
      arc,
    ])

    const originLineApply = getConstraintToolPreparedApply(
      'midpointConstraintTool',
      [ORIGIN_TARGET, 10],
      objects
    )
    expect(originLineApply?.payload).toEqual({
      type: 'Midpoint',
      point: 'ORIGIN',
      segment: 10,
    })

    const lineOriginApply = getConstraintToolPreparedApply(
      'midpointConstraintTool',
      [10, ORIGIN_TARGET],
      objects
    )
    expect(lineOriginApply?.payload).toEqual({
      type: 'Midpoint',
      point: 'ORIGIN',
      segment: 10,
    })

    const originArcApply = getConstraintToolPreparedApply(
      'midpointConstraintTool',
      [ORIGIN_TARGET, 11],
      objects
    )
    expect(originArcApply?.payload).toEqual({
      type: 'Midpoint',
      point: 'ORIGIN',
      segment: 11,
    })

    const arcOriginApply = getConstraintToolPreparedApply(
      'midpointConstraintTool',
      [11, ORIGIN_TARGET],
      objects
    )
    expect(arcOriginApply?.payload).toEqual({
      type: 'Midpoint',
      point: 'ORIGIN',
      segment: 11,
    })
  })

  it('prepares equal-length payloads from the full valid current selection', () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const pointD = createPointApiObject({ id: 4 })
    const pointE = createPointApiObject({ id: 5 })
    const pointF = createPointApiObject({ id: 6 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const lineC = createLineApiObject({ id: 12, start: 5, end: 6 })
    const objects = createObjectsArray([
      pointA,
      pointB,
      pointC,
      pointD,
      pointE,
      pointF,
      lineA,
      lineB,
      lineC,
    ])

    const apply = getConstraintToolPreparedApply(
      'equalLengthConstraintTool',
      [10, 11, 12],
      objects
    )

    expect(apply?.payload).toEqual({
      type: 'LinesEqualLength',
      lines: [10, 11, 12],
    })
  })

  it('prepares fixed payloads from point selections', () => {
    const point = createPointApiObject({ id: 1, x: 3, y: 4 })
    const objects = createObjectsArray([point])

    const apply = getConstraintToolPreparedApply(
      'fixedConstraintTool',
      [1],
      objects
    )

    expect(apply?.payload).toEqual({
      type: 'Fixed',
      points: [
        {
          point: 1,
          position: {
            x: { value: 3, units: 'Mm' },
            y: { value: 4, units: 'Mm' },
          },
        },
      ],
    })
  })

  it('uses click semantics that match the equipped-tool UX', () => {
    const point = createPointApiObject({ id: 1 })
    const otherPoint = createPointApiObject({ id: 2 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const objects = createObjectsArray([point, otherPoint, line])

    const singleLineClick = resolveConstraintToolClickAction(
      'horizontalConstraintTool',
      [],
      3,
      objects
    )
    expect(singleLineClick.type).toBe('apply')

    const firstPointClick = resolveConstraintToolClickAction(
      'horizontalConstraintTool',
      [],
      1,
      objects
    )
    expect(firstPointClick).toMatchObject({
      type: 'select',
      nextSelectionIds: [1],
    })

    const invalidSecondClick = resolveConstraintToolClickAction(
      'horizontalConstraintTool',
      [1],
      3,
      objects
    )
    expect(invalidSecondClick).toEqual({
      type: 'clear',
      nextSelectionIds: [],
    })

    const validSecondClick = resolveConstraintToolClickAction(
      'horizontalConstraintTool',
      [1],
      ORIGIN_TARGET,
      objects
    )
    expect(validSecondClick.type).toBe('apply')
    if (validSecondClick.type === 'apply') {
      expect(validSecondClick.apply.payload).toEqual({
        type: 'Horizontal',
        points: [1, 'ORIGIN'],
      })
    }

    const verticalPointPairClick = resolveConstraintToolClickAction(
      'verticalConstraintTool',
      [1],
      ORIGIN_TARGET,
      objects
    )
    expect(verticalPointPairClick.type).toBe('apply')
    if (verticalPointPairClick.type === 'apply') {
      expect(verticalPointPairClick.apply.payload).toEqual({
        type: 'Vertical',
        points: [1, 'ORIGIN'],
      })
    }
  })

  it('supports partial-then-apply click flow for two-line tools', () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const pointD = createPointApiObject({ id: 4 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const objects = createObjectsArray([
      pointA,
      pointB,
      pointC,
      pointD,
      lineA,
      lineB,
    ])

    const firstClick = resolveConstraintToolClickAction(
      'parallelConstraintTool',
      [],
      10,
      objects
    )
    expect(firstClick).toMatchObject({
      type: 'select',
      nextSelectionIds: [10],
    })

    const secondClick = resolveConstraintToolClickAction(
      'parallelConstraintTool',
      [10],
      11,
      objects
    )
    expect(secondClick.type).toBe('apply')
    if (secondClick.type === 'apply') {
      expect(secondClick.apply.payload).toEqual({
        type: 'Parallel',
        lines: [10, 11],
      })
    }
  })

  it('keeps symmetric line triples selected until the user explicitly clicks the axis', () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const pointD = createPointApiObject({ id: 4 })
    const pointE = createPointApiObject({ id: 5 })
    const pointF = createPointApiObject({ id: 6 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const lineC = createLineApiObject({ id: 12, start: 5, end: 6 })
    const objects = createObjectsArray([
      pointA,
      pointB,
      pointC,
      pointD,
      pointE,
      pointF,
      lineA,
      lineB,
      lineC,
    ])

    const areaSelection = resolveConstraintToolSelectionAction(
      'symmetricConstraintTool',
      [],
      [10, 11, 12],
      objects
    )
    expect(areaSelection).toMatchObject({
      type: 'select',
      nextSelectionIds: [10, 11, 12],
    })
  })

  it('prepares one payload per additional line for parallel area selection', () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const pointD = createPointApiObject({ id: 4 })
    const pointE = createPointApiObject({ id: 5 })
    const pointF = createPointApiObject({ id: 6 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const lineC = createLineApiObject({ id: 12, start: 5, end: 6 })
    const objects = createObjectsArray([
      pointA,
      pointB,
      pointC,
      pointD,
      pointE,
      pointF,
      lineA,
      lineB,
      lineC,
    ])

    const apply = getConstraintToolPreparedApply(
      'parallelConstraintTool',
      [10, 11, 12],
      objects
    )

    expect(apply?.selectionIds).toEqual([10, 11, 12])
    expect(apply?.payloads).toEqual([
      {
        type: 'Parallel',
        lines: [10, 11],
      },
      {
        type: 'Parallel',
        lines: [10, 12],
      },
    ])
    expect(apply?.payload).toEqual({
      type: 'Parallel',
      lines: [10, 11],
    })
  })

  it('uses the same compatibility rules for area-style batch selections', () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const line = createLineApiObject({ id: 10, start: 2, end: 3 })
    const objects = createObjectsArray([pointA, pointB, pointC, line])

    const invalidBatch = resolveConstraintToolSelectionAction(
      'horizontalConstraintTool',
      [1],
      [10],
      objects
    )
    expect(invalidBatch).toEqual({
      type: 'clear',
      nextSelectionIds: [],
    })

    const validBatch = resolveConstraintToolSelectionAction(
      'horizontalConstraintTool',
      [1],
      [10, 2],
      objects
    )
    expect(validBatch.type).toBe('apply')
    if (validBatch.type === 'apply') {
      expect(validBatch.apply.payload).toEqual({
        type: 'Horizontal',
        points: [1, 2],
      })
    }
  })

  it('applies the full compatible line set for parallel area selection', () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const pointD = createPointApiObject({ id: 4 })
    const pointE = createPointApiObject({ id: 5 })
    const pointF = createPointApiObject({ id: 6 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const lineC = createLineApiObject({ id: 12, start: 5, end: 6 })
    const objects = createObjectsArray([
      pointA,
      pointB,
      pointC,
      pointD,
      pointE,
      pointF,
      lineA,
      lineB,
      lineC,
    ])

    const areaSelection = resolveConstraintToolSelectionAction(
      'parallelConstraintTool',
      [],
      [10, 11, 12],
      objects
    )

    expect(areaSelection.type).toBe('apply')
    if (areaSelection.type === 'apply') {
      expect(areaSelection.apply.selectionIds).toEqual([10, 11, 12])
      expect(areaSelection.apply.payloads).toEqual([
        {
          type: 'Parallel',
          lines: [10, 11],
        },
        {
          type: 'Parallel',
          lines: [10, 12],
        },
      ])
    }
  })

  it('prepares one payload per selected line for horizontal area selection', () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const pointD = createPointApiObject({ id: 4 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const objects = createObjectsArray([
      pointA,
      pointB,
      pointC,
      pointD,
      lineA,
      lineB,
    ])

    const batchApply = getConstraintToolPreparedApply(
      'horizontalConstraintTool',
      [10, 11],
      objects
    )

    expect(batchApply?.selectionIds).toEqual([10, 11])
    expect(batchApply?.payloads).toEqual([
      {
        type: 'Horizontal',
        line: 10,
      },
      {
        type: 'Horizontal',
        line: 11,
      },
    ])
    expect(batchApply?.payload).toEqual({
      type: 'Horizontal',
      line: 10,
    })
  })

  it('applies the full filtered equal-length set from area selection', () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const pointD = createPointApiObject({ id: 4 })
    const pointE = createPointApiObject({ id: 5 })
    const pointF = createPointApiObject({ id: 6 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const lineC = createLineApiObject({ id: 12, start: 5, end: 6 })
    const objects = createObjectsArray([
      pointA,
      pointB,
      pointC,
      pointD,
      pointE,
      pointF,
      lineA,
      lineB,
      lineC,
    ])

    const batchApply = resolveConstraintToolSelectionAction(
      'equalLengthConstraintTool',
      [],
      [10, 11, 12],
      objects
    )

    expect(batchApply.type).toBe('apply')
    if (batchApply.type === 'apply') {
      expect(batchApply.apply.payload).toEqual({
        type: 'LinesEqualLength',
        lines: [10, 11, 12],
      })
    }
  })

  it('builds tangent payloads for Rust-supported combinations', () => {
    const center = createPointApiObject({ id: 1 })
    const arcStart = createPointApiObject({ id: 2 })
    const arcEnd = createPointApiObject({ id: 3 })
    const lineStart = createPointApiObject({ id: 4 })
    const lineEnd = createPointApiObject({ id: 5 })
    const circleStart = createPointApiObject({ id: 6 })
    const arc = createArcApiObject({ id: 10, center: 1, start: 2, end: 3 })
    const line = createLineApiObject({ id: 11, start: 4, end: 5 })
    const circle = createCircleApiObject({ id: 12, center: 1, start: 6 })
    const objects = createObjectsArray([
      center,
      arcStart,
      arcEnd,
      lineStart,
      lineEnd,
      circleStart,
      arc,
      line,
      circle,
    ])

    const lineCircle = getConstraintToolPreparedApply(
      'tangentConstraintTool',
      [11, 12],
      objects
    )
    expect(lineCircle?.payload).toEqual({
      type: 'Tangent',
      input: [11, 12],
    })

    const arcCircle = getConstraintToolPreparedApply(
      'tangentConstraintTool',
      [10, 12],
      objects
    )
    expect(arcCircle?.payload).toEqual({
      type: 'Tangent',
      input: [10, 12],
    })
  })

  it('builds symmetric payloads for explicit point/axis input and requires an explicit axis click for line triples', () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const pointD = createPointApiObject({ id: 4 })
    const pointE = createPointApiObject({ id: 5 })
    const pointF = createPointApiObject({ id: 6 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const lineC = createLineApiObject({ id: 12, start: 5, end: 6 })
    const objects = createObjectsArray([
      pointA,
      pointB,
      pointC,
      pointD,
      pointE,
      pointF,
      lineA,
      lineB,
      lineC,
    ])

    const pointApply = getConstraintToolPreparedApply(
      'symmetricConstraintTool',
      [1, 2, 10],
      objects
    )
    expect(pointApply?.payload).toEqual({
      type: 'Symmetric',
      input: [1, 2],
      axis: 10,
    })

    const lineApply = getConstraintToolPreparedApply(
      'symmetricConstraintTool',
      [10, 11, 12],
      objects
    )
    expect(lineApply).toBeNull()

    const explicitAxisClick = resolveConstraintToolClickAction(
      'symmetricConstraintTool',
      [10, 11, 12],
      10,
      objects
    )
    expect(explicitAxisClick.type).toBe('apply')
    if (explicitAxisClick.type === 'apply') {
      expect(explicitAxisClick.apply.payload).toEqual({
        type: 'Symmetric',
        input: [11, 12],
        axis: 10,
      })
    }
  })
})
