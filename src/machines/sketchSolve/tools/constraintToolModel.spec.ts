import { describe, expect, it } from 'vitest'

import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { ORIGIN_TARGET } from '@src/machines/sketchSolve/sketchSolveSelection'
import {
  classifyConstraintSelection,
  constraintToolNames,
  getConstraintToolPermittedSelectionKinds,
  getConstraintToolSelectionMatches,
} from '@src/machines/sketchSolve/tools/constraintToolModel'
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

describe('constraintToolModel', () => {
  it('defines all constraint tool names', () => {
    expect(constraintToolNames).toEqual([
      'coincidentConstraintTool',
      'midpointConstraintTool',
      'symmetricConstraintTool',
      'tangentConstraintTool',
      'parallelConstraintTool',
      'equalLengthConstraintTool',
      'horizontalConstraintTool',
      'verticalConstraintTool',
      'perpendicularConstraintTool',
      'fixedConstraintTool',
    ])
  })

  it('recognizes midpoint selections in point/origin and line/arc order', () => {
    const point = createPointApiObject({ id: 1 })
    const lineStart = createPointApiObject({ id: 2 })
    const lineEnd = createPointApiObject({ id: 3 })
    const line = createLineApiObject({ id: 10, start: 2, end: 3 })
    const arc = createArcApiObject({ id: 11, center: 1, start: 2, end: 3 })
    const objects = createObjectsArray([point, lineStart, lineEnd, line, arc])

    const pointLine = getConstraintToolSelectionMatches(
      'midpointConstraintTool',
      [1, 10],
      objects
    )
    expect(pointLine.status).toBe('complete')
    expect(pointLine.bestMatch?.mode.id).toBe('point-line')

    const linePoint = getConstraintToolSelectionMatches(
      'midpointConstraintTool',
      [10, 1],
      objects
    )
    expect(linePoint.status).toBe('complete')
    expect(linePoint.bestMatch?.mode.id).toBe('line-point')

    const pointArc = getConstraintToolSelectionMatches(
      'midpointConstraintTool',
      [1, 11],
      objects
    )
    expect(pointArc.status).toBe('complete')
    expect(pointArc.bestMatch?.mode.id).toBe('point-arc')

    const arcPoint = getConstraintToolSelectionMatches(
      'midpointConstraintTool',
      [11, 1],
      objects
    )
    expect(arcPoint.status).toBe('complete')
    expect(arcPoint.bestMatch?.mode.id).toBe('arc-point')

    const originLine = getConstraintToolSelectionMatches(
      'midpointConstraintTool',
      [ORIGIN_TARGET, 10],
      objects
    )
    expect(originLine.status).toBe('complete')
    expect(originLine.bestMatch?.mode.id).toBe('origin-line')

    const lineOrigin = getConstraintToolSelectionMatches(
      'midpointConstraintTool',
      [10, ORIGIN_TARGET],
      objects
    )
    expect(lineOrigin.status).toBe('complete')
    expect(lineOrigin.bestMatch?.mode.id).toBe('line-origin')

    const originArc = getConstraintToolSelectionMatches(
      'midpointConstraintTool',
      [ORIGIN_TARGET, 11],
      objects
    )
    expect(originArc.status).toBe('complete')
    expect(originArc.bestMatch?.mode.id).toBe('origin-arc')

    const arcOrigin = getConstraintToolSelectionMatches(
      'midpointConstraintTool',
      [11, ORIGIN_TARGET],
      objects
    )
    expect(arcOrigin.status).toBe('complete')
    expect(arcOrigin.bestMatch?.mode.id).toBe('arc-origin')
  })

  it('classifies sketch solve selections into reusable kinds', () => {
    const point = createPointApiObject({ id: 1 })
    const otherPoint = createPointApiObject({ id: 2 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const arc = createArcApiObject({ id: 4, center: 1, start: 2, end: 2 })
    const circle = createCircleApiObject({ id: 5, center: 1, start: 2 })
    const dimension = createConstraintApiObject({ id: 6, type: 'Distance' })
    const constraint = createConstraintApiObject({ id: 7, type: 'Horizontal' })
    const objects = createObjectsArray([
      point,
      otherPoint,
      line,
      arc,
      circle,
      dimension,
      constraint,
    ])

    expect(classifyConstraintSelection(1, objects).kind).toBe('point')
    expect(classifyConstraintSelection(3, objects).kind).toBe('line')
    expect(classifyConstraintSelection(4, objects).kind).toBe('arc')
    expect(classifyConstraintSelection(5, objects).kind).toBe('circle')
    expect(classifyConstraintSelection(6, objects).kind).toBe('dimension')
    expect(classifyConstraintSelection(7, objects).kind).toBe('constraint')
    expect(classifyConstraintSelection(999, objects).kind).toBe('other')
    expect(classifyConstraintSelection(ORIGIN_TARGET, objects).kind).toBe(
      'origin'
    )
  })

  it('recognizes horizontal and vertical selections for line and point-pair modes', () => {
    const point = createPointApiObject({ id: 1 })
    const secondPoint = createPointApiObject({ id: 2 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const objects = createObjectsArray([point, secondPoint, line])

    const lineSelection = getConstraintToolSelectionMatches(
      'horizontalConstraintTool',
      [3],
      objects
    )
    expect(lineSelection.status).toBe('complete')
    expect(lineSelection.bestMatch?.mode.id).toBe('single-line')
    expect(lineSelection.bestMatch?.mode.resultingConstraintType).toBe(
      'Horizontal'
    )

    const pointPrefix = getConstraintToolSelectionMatches(
      'horizontalConstraintTool',
      [1],
      objects
    )
    expect(pointPrefix.status).toBe('partial')

    const pointPair = getConstraintToolSelectionMatches(
      'horizontalConstraintTool',
      [1, ORIGIN_TARGET],
      objects
    )
    expect(pointPair.status).toBe('complete')
    expect(pointPair.bestMatch?.mode.id).toBe('point-pair')
    expect(pointPair.bestMatch?.mode.resultingConstraintType).toBe('Horizontal')

    const verticalPointPair = getConstraintToolSelectionMatches(
      'verticalConstraintTool',
      [1, ORIGIN_TARGET],
      objects
    )
    expect(verticalPointPair.status).toBe('complete')
    expect(verticalPointPair.bestMatch?.mode.id).toBe('point-pair')
    expect(verticalPointPair.bestMatch?.mode.resultingConstraintType).toBe(
      'Vertical'
    )
  })

  it('recognizes grouped point coincident selections as complete', () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const objects = createObjectsArray([pointA, pointB, pointC])

    const pointCluster = getConstraintToolSelectionMatches(
      'coincidentConstraintTool',
      [1, 2, 3],
      objects
    )
    expect(pointCluster.status).toBe('complete')
    expect(pointCluster.bestMatch?.mode.id).toBe('point-point')

    const originCluster = getConstraintToolSelectionMatches(
      'coincidentConstraintTool',
      [ORIGIN_TARGET, 1, 2],
      objects
    )
    expect(originCluster.status).toBe('complete')
    expect(originCluster.bestMatch?.mode.id).toBe('origin-point')
  })

  it('keeps parallel and perpendicular line-only', () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const pointD = createPointApiObject({ id: 4 })
    const pointE = createPointApiObject({ id: 5 })
    const pointF = createPointApiObject({ id: 6 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const lineC = createLineApiObject({ id: 13, start: 5, end: 6 })
    const arc = createArcApiObject({ id: 12, center: 1, start: 2, end: 3 })
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
      arc,
    ])

    expect(
      getConstraintToolSelectionMatches(
        'parallelConstraintTool',
        [10, 11],
        objects
      ).status
    ).toBe('complete')
    expect(
      getConstraintToolSelectionMatches(
        'parallelConstraintTool',
        [10, 11, 13],
        objects
      ).status
    ).toBe('complete')
    expect(
      getConstraintToolSelectionMatches(
        'perpendicularConstraintTool',
        [10, 12],
        objects
      ).status
    ).toBe('invalid')
  })

  it('recognizes tangent combinations from the Rust-supported modes', () => {
    const center = createPointApiObject({ id: 1 })
    const arcStart = createPointApiObject({ id: 2 })
    const arcEnd = createPointApiObject({ id: 3 })
    const lineStart = createPointApiObject({ id: 4 })
    const lineEnd = createPointApiObject({ id: 5 })
    const circleStart = createPointApiObject({ id: 6 })
    const arc = createArcApiObject({ id: 10, center: 1, start: 2, end: 3 })
    const line = createLineApiObject({ id: 11, start: 4, end: 5 })
    const circle = createCircleApiObject({ id: 12, center: 1, start: 6 })
    const otherLine = createLineApiObject({ id: 13, start: 2, end: 6 })
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
      otherLine,
    ])

    expect(
      getConstraintToolSelectionMatches(
        'tangentConstraintTool',
        [11, 12],
        objects
      ).status
    ).toBe('complete')
    expect(
      getConstraintToolSelectionMatches(
        'tangentConstraintTool',
        [10, 12],
        objects
      ).status
    ).toBe('complete')
    expect(
      getConstraintToolSelectionMatches(
        'tangentConstraintTool',
        [11, 13],
        objects
      ).status
    ).toBe('invalid')
  })

  it('recognizes symmetric selections for points, arc-like segments, and lines', () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const pointD = createPointApiObject({ id: 4 })
    const pointE = createPointApiObject({ id: 5 })
    const pointF = createPointApiObject({ id: 6 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const lineC = createLineApiObject({ id: 12, start: 5, end: 6 })
    const arc = createArcApiObject({ id: 13, center: 1, start: 2, end: 3 })
    const circle = createCircleApiObject({ id: 14, center: 4, start: 5 })
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
      arc,
      circle,
    ])

    const pointPointLine = getConstraintToolSelectionMatches(
      'symmetricConstraintTool',
      [1, 2, 10],
      objects
    )
    expect(pointPointLine.status).toBe('complete')
    expect(pointPointLine.bestMatch?.mode.id).toBe('point-point-line')

    const arcLikeLineArcLike = getConstraintToolSelectionMatches(
      'symmetricConstraintTool',
      [13, 10, 14],
      objects
    )
    expect(arcLikeLineArcLike.status).toBe('complete')
    expect(arcLikeLineArcLike.bestMatch?.mode.id).toBe('arcLike-line-arcLike')

    const lineTriple = getConstraintToolSelectionMatches(
      'symmetricConstraintTool',
      [10, 11, 12],
      objects
    )
    expect(lineTriple.status).toBe('complete')
    expect(lineTriple.bestMatch?.mode.id).toBe('line-line-line')

    expect(
      getConstraintToolSelectionMatches(
        'symmetricConstraintTool',
        [1, 10, 11],
        objects
      ).status
    ).toBe('invalid')
  })

  it('captures equal-length line and arc-like set behavior', () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const pointD = createPointApiObject({ id: 4 })
    const pointE = createPointApiObject({ id: 5 })
    const pointF = createPointApiObject({ id: 6 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const lineC = createLineApiObject({ id: 12, start: 5, end: 6 })
    const arc = createArcApiObject({ id: 13, center: 1, start: 2, end: 3 })
    const circle = createCircleApiObject({ id: 14, center: 4, start: 5 })
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
      arc,
      circle,
    ])

    const threeLines = getConstraintToolSelectionMatches(
      'equalLengthConstraintTool',
      [10, 11, 12],
      objects
    )
    expect(threeLines.status).toBe('complete')
    expect(threeLines.bestMatch?.mode.id).toBe('line-set')
    expect(threeLines.bestMatch?.mode.areaSelectionPolicy).toBe(
      'consume-all-compatible'
    )

    const arcLikePair = getConstraintToolSelectionMatches(
      'equalLengthConstraintTool',
      [13, 14],
      objects
    )
    expect(arcLikePair.status).toBe('complete')
    expect(arcLikePair.bestMatch?.mode.id).toBe('arcLike-set')

    expect(
      getConstraintToolSelectionMatches(
        'equalLengthConstraintTool',
        [10, 14],
        objects
      ).status
    ).toBe('invalid')
  })

  it('captures the supported coincident combinations', () => {
    const point = createPointApiObject({ id: 1 })
    const otherPoint = createPointApiObject({ id: 2 })
    const line = createLineApiObject({ id: 10, start: 1, end: 2 })
    const arc = createArcApiObject({ id: 11, center: 1, start: 2, end: 2 })
    const circle = createCircleApiObject({ id: 12, center: 1, start: 2 })
    const objects = createObjectsArray([point, otherPoint, line, arc, circle])

    expect(
      getConstraintToolSelectionMatches(
        'coincidentConstraintTool',
        [1, 2],
        objects
      ).status
    ).toBe('complete')
    expect(
      getConstraintToolSelectionMatches(
        'coincidentConstraintTool',
        [1, 10],
        objects
      ).status
    ).toBe('complete')
    expect(
      getConstraintToolSelectionMatches(
        'coincidentConstraintTool',
        [1, 11],
        objects
      ).status
    ).toBe('complete')
    expect(
      getConstraintToolSelectionMatches(
        'coincidentConstraintTool',
        [1, 12],
        objects
      ).status
    ).toBe('complete')
    expect(
      getConstraintToolSelectionMatches(
        'coincidentConstraintTool',
        [10, 10],
        objects
      ).status
    ).toBe('complete')
    expect(
      getConstraintToolSelectionMatches(
        'coincidentConstraintTool',
        [1, ORIGIN_TARGET],
        objects
      ).status
    ).toBe('complete')
    expect(
      getConstraintToolSelectionMatches(
        'coincidentConstraintTool',
        [11, 10],
        objects
      ).status
    ).toBe('invalid')
  })

  it('exposes permitted selection kinds per tool for later filtering logic', () => {
    expect(
      getConstraintToolPermittedSelectionKinds('fixedConstraintTool')
    ).toEqual(expect.arrayContaining(['point']))
    expect(
      getConstraintToolPermittedSelectionKinds('horizontalConstraintTool')
    ).toEqual(expect.arrayContaining(['line', 'point', 'origin']))
    expect(
      getConstraintToolPermittedSelectionKinds('tangentConstraintTool')
    ).toEqual(expect.arrayContaining(['line', 'arc', 'circle']))
    expect(
      getConstraintToolPermittedSelectionKinds('symmetricConstraintTool')
    ).toEqual(expect.arrayContaining(['point', 'line', 'arc', 'circle']))
    expect(
      getConstraintToolPermittedSelectionKinds('parallelConstraintTool')
    ).toEqual(['line'])
  })
})
