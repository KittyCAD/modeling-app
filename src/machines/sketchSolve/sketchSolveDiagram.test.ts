import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  buildAngleConstraintInput,
  buildCircularSizeDimensionConstraintInput,
  buildEqualLengthConstraintInput,
  buildFixedConstraintInput,
  buildSymmetricConstraintInput,
  buildSymmetricConstraintInputWithExplicitAxis,
  buildTangentConstraintInput,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  createArcApiObject,
  createCircleApiObject,
  createLineApiObject,
  createPointApiObject,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { describe, expect, it } from 'vitest'

function createObjectsArray(objects: ApiObject[]) {
  const array: ApiObject[] = []
  for (const object of objects) {
    array[object.id] = object
  }
  return array
}

describe('buildAngleConstraintInput', () => {
  it('builds a 45deg angle constraint for lines (0,0)->(0,10) and (0,0)->(10,10)', () => {
    const origin = createPointApiObject({ id: 1, x: 0, y: 0 })
    const up = createPointApiObject({ id: 2, x: 0, y: 10 })
    const diag = createPointApiObject({ id: 3, x: 10, y: 10 })

    const verticalLine = createLineApiObject({ id: 10, start: 1, end: 2 })
    const diagonalLine = createLineApiObject({ id: 11, start: 1, end: 3 })
    const objects = createObjectsArray([
      origin,
      up,
      diag,
      verticalLine,
      diagonalLine,
    ])

    const constraint = buildAngleConstraintInput(
      diagonalLine,
      verticalLine,
      objects
    )

    expect(constraint).toEqual({
      type: 'Angle',
      lines: [11, 10],
      angle: { value: 45, units: 'Deg' },
      source: { expr: '45deg', is_literal: true },
    })
  })

  it('flips line order to keep the smaller angle when one line direction is inverted', () => {
    const origin = createPointApiObject({ id: 1, x: 0, y: 0 })
    const up = createPointApiObject({ id: 2, x: 0, y: 10 })
    const diag = createPointApiObject({ id: 3, x: 10, y: 10 })

    const verticalLineInverted = createLineApiObject({
      id: 12,
      start: 2,
      end: 1,
    })
    const diagonalLine = createLineApiObject({ id: 11, start: 1, end: 3 })
    const objects = createObjectsArray([
      origin,
      up,
      diag,
      verticalLineInverted,
      diagonalLine,
    ])

    const constraint = buildAngleConstraintInput(
      diagonalLine,
      verticalLineInverted,
      objects
    )

    expect(constraint).toEqual({
      type: 'Angle',
      lines: [12, 11],
      angle: { value: 135, units: 'Deg' },
      source: { expr: '135deg', is_literal: true },
    })
  })

  it('supports angle constraints on owned control polygon edges', () => {
    const origin = createPointApiObject({ id: 1, x: 0, y: 0 })
    const up = createPointApiObject({ id: 2, x: 0, y: 10 })
    const diag = createPointApiObject({ id: 3, x: 10, y: 10 })
    const ownedLine = createLineApiObject({
      id: 10,
      start: 1,
      end: 2,
      owner: 99,
    })
    const diagonalLine = createLineApiObject({ id: 11, start: 1, end: 3 })
    const objects = createObjectsArray([
      origin,
      up,
      diag,
      ownedLine,
      diagonalLine,
    ])

    expect(buildAngleConstraintInput(ownedLine, diagonalLine, objects)).toEqual(
      {
        type: 'Angle',
        lines: [11, 10],
        angle: { value: 45, units: 'Deg' },
        source: { expr: '45deg', is_literal: true },
      }
    )
  })
})

describe('buildArcSizeDimensionConstraintInput', () => {
  it('builds radius dimensions for arcs', () => {
    const arc = createArcApiObject({ id: 10, center: 1, start: 2, end: 3 })

    expect(
      buildCircularSizeDimensionConstraintInput({
        segment: arc,
        radius: 5,
        units: 'Mm',
      })
    ).toEqual({
      type: 'Radius',
      radius: { value: 5, units: 'Mm' },
      arc: 10,
      source: { expr: '5', is_literal: true },
    })
  })

  it('builds diameter dimensions for circles', () => {
    const circle = createCircleApiObject({ id: 11, center: 1, start: 2 })

    expect(
      buildCircularSizeDimensionConstraintInput({
        segment: circle,
        radius: 5,
        units: 'Mm',
      })
    ).toEqual({
      type: 'Diameter',
      diameter: { value: 10, units: 'Mm' },
      arc: 11,
      source: { expr: '10', is_literal: true },
    })
  })
})

describe('buildTangentConstraintInput', () => {
  it('builds a tangent constraint for one selected line and one selected arc', () => {
    const center = createPointApiObject({ id: 1, x: 5, y: 5 })
    const arcStart = createPointApiObject({ id: 2, x: 0, y: 0 })
    const arcEnd = createPointApiObject({ id: 3, x: 10, y: 0 })
    const lineStart = createPointApiObject({ id: 4, x: 0, y: 0 })
    const lineEnd = createPointApiObject({ id: 5, x: 10, y: 0 })
    const arc = createArcApiObject({ id: 10, center: 1, start: 2, end: 3 })
    const line = createLineApiObject({ id: 11, start: 4, end: 5 })
    const objects = createObjectsArray([
      center,
      arcStart,
      arcEnd,
      lineStart,
      lineEnd,
      arc,
      line,
    ])

    expect(buildTangentConstraintInput([11, 10], objects)).toEqual({
      type: 'Tangent',
      input: [11, 10],
    })
    expect(buildTangentConstraintInput([10, 11], objects)).toEqual({
      type: 'Tangent',
      input: [11, 10],
    })
  })

  it('builds a tangent constraint for two selected arcs', () => {
    const center1 = createPointApiObject({ id: 1, x: 5, y: 5 })
    const arc1Start = createPointApiObject({ id: 2, x: 0, y: 0 })
    const arc1End = createPointApiObject({ id: 3, x: 10, y: 0 })
    const center2 = createPointApiObject({ id: 4, x: 15, y: 5 })
    const arc2Start = createPointApiObject({ id: 5, x: 10, y: 0 })
    const arc2End = createPointApiObject({ id: 6, x: 20, y: 0 })
    const arc1 = createArcApiObject({ id: 10, center: 1, start: 2, end: 3 })
    const arc2 = createArcApiObject({ id: 11, center: 4, start: 5, end: 6 })
    const objects = createObjectsArray([
      center1,
      arc1Start,
      arc1End,
      center2,
      arc2Start,
      arc2End,
      arc1,
      arc2,
    ])

    expect(buildTangentConstraintInput([10, 11], objects)).toEqual({
      type: 'Tangent',
      input: [10, 11],
    })
    expect(buildTangentConstraintInput([11, 10], objects)).toEqual({
      type: 'Tangent',
      input: [11, 10],
    })
  })

  it('returns null unless the selection is line+arc or arc+arc', () => {
    const p1 = createPointApiObject({ id: 1, x: 0, y: 0 })
    const p2 = createPointApiObject({ id: 2, x: 10, y: 0 })
    const p3 = createPointApiObject({ id: 3, x: 20, y: 0 })
    const line1 = createLineApiObject({ id: 10, start: 1, end: 2 })
    const line2 = createLineApiObject({ id: 11, start: 2, end: 3 })
    const objects = createObjectsArray([p1, p2, p3, line1, line2])

    expect(buildTangentConstraintInput([], objects)).toBeNull()
    expect(buildTangentConstraintInput([10], objects)).toBeNull()
    expect(buildTangentConstraintInput([10, 11], objects)).toBeNull()
  })

  it('supports tangent constraints when the selected line is an owned control polygon edge', () => {
    const center = createPointApiObject({ id: 1, x: 5, y: 5 })
    const arcStart = createPointApiObject({ id: 2, x: 0, y: 0 })
    const arcEnd = createPointApiObject({ id: 3, x: 10, y: 0 })
    const lineStart = createPointApiObject({ id: 4, x: 0, y: 0 })
    const lineEnd = createPointApiObject({ id: 5, x: 10, y: 0 })
    const arc = createArcApiObject({ id: 10, center: 1, start: 2, end: 3 })
    const ownedLine = createLineApiObject({
      id: 11,
      start: 4,
      end: 5,
      owner: 42,
    })
    const objects = createObjectsArray([
      center,
      arcStart,
      arcEnd,
      lineStart,
      lineEnd,
      arc,
      ownedLine,
    ])

    expect(buildTangentConstraintInput([11, 10], objects)).toEqual({
      type: 'Tangent',
      input: [11, 10],
    })
  })
})

describe('buildEqualLengthConstraintInput', () => {
  it('supports equal length when any selected line is an owned control polygon edge', () => {
    const p1 = createPointApiObject({ id: 1, x: 0, y: 0 })
    const p2 = createPointApiObject({ id: 2, x: 10, y: 0 })
    const p3 = createPointApiObject({ id: 3, x: 20, y: 0 })
    const p4 = createPointApiObject({ id: 4, x: 30, y: 0 })
    const ownedLine = createLineApiObject({
      id: 10,
      start: 1,
      end: 2,
      owner: 77,
    })
    const line = createLineApiObject({ id: 11, start: 3, end: 4 })
    const objects = createObjectsArray([p1, p2, p3, p4, ownedLine, line])

    expect(buildEqualLengthConstraintInput([10, 11], objects)).toEqual({
      type: 'LinesEqualLength',
      lines: [10, 11],
    })
  })
})

describe('buildSymmetricConstraintInput', () => {
  it('builds a symmetric constraint for two points and an axis line', () => {
    const pointA = createPointApiObject({ id: 1, x: -5, y: 0 })
    const pointB = createPointApiObject({ id: 2, x: 5, y: 0 })
    const axisStart = createPointApiObject({ id: 3, x: 0, y: -10 })
    const axisEnd = createPointApiObject({ id: 4, x: 0, y: 10 })
    const axis = createLineApiObject({ id: 10, start: 3, end: 4 })
    const objects = createObjectsArray([
      pointA,
      pointB,
      axisStart,
      axisEnd,
      axis,
    ])

    expect(buildSymmetricConstraintInput([1, 2, 10], objects)).toEqual({
      type: 'Symmetric',
      input: [1, 2],
      axis: 10,
    })
  })

  it('builds a symmetric constraint for two arc-like segments and an axis line', () => {
    const centerA = createPointApiObject({ id: 1, x: -10, y: 0 })
    const startA = createPointApiObject({ id: 2, x: -15, y: 0 })
    const endA = createPointApiObject({ id: 3, x: -10, y: 5 })
    const centerB = createPointApiObject({ id: 4, x: 10, y: 0 })
    const startB = createPointApiObject({ id: 5, x: 15, y: 0 })
    const axisStart = createPointApiObject({ id: 6, x: 0, y: -10 })
    const axisEnd = createPointApiObject({ id: 7, x: 0, y: 10 })
    const arc = createArcApiObject({ id: 10, center: 1, start: 2, end: 3 })
    const circle = createCircleApiObject({ id: 11, center: 4, start: 5 })
    const axis = createLineApiObject({ id: 12, start: 6, end: 7 })
    const objects = createObjectsArray([
      centerA,
      startA,
      endA,
      centerB,
      startB,
      axisStart,
      axisEnd,
      arc,
      circle,
      axis,
    ])

    expect(buildSymmetricConstraintInput([10, 12, 11], objects)).toEqual({
      type: 'Symmetric',
      input: [10, 11],
      axis: 12,
    })
  })

  it('requires an explicit axis when three lines are selected', () => {
    const p1 = createPointApiObject({ id: 1, x: 0, y: -10 })
    const p2 = createPointApiObject({ id: 2, x: 0, y: 10 })
    const p3 = createPointApiObject({ id: 3, x: -10, y: 0 })
    const p4 = createPointApiObject({ id: 4, x: -10, y: 5 })
    const p5 = createPointApiObject({ id: 5, x: 10, y: 0 })
    const p6 = createPointApiObject({ id: 6, x: 10, y: 5 })
    const axis = createLineApiObject({ id: 10, start: 1, end: 2 })
    const left = createLineApiObject({ id: 11, start: 3, end: 4 })
    const right = createLineApiObject({ id: 12, start: 5, end: 6 })
    const objects = createObjectsArray([
      p1,
      p2,
      p3,
      p4,
      p5,
      p6,
      axis,
      left,
      right,
    ])

    expect(buildSymmetricConstraintInput([10, 11, 12], objects)).toBeNull()
    expect(
      buildSymmetricConstraintInputWithExplicitAxis({
        selectedIds: [10, 11, 12],
        axisId: 10,
        objects,
      })
    ).toEqual({
      type: 'Symmetric',
      input: [11, 12],
      axis: 10,
    })
  })
})

describe('buildFixedConstraintInput', () => {
  it('builds a fixed-point input for one selected point', () => {
    const point = createPointApiObject({ id: 10, x: 3, y: 4 })
    const objects = createObjectsArray([point])

    expect(buildFixedConstraintInput([10], objects)).toEqual([
      {
        point: 10,
        position: {
          x: { value: 3, units: 'Mm' },
          y: { value: 4, units: 'Mm' },
        },
      },
    ])
  })

  it('builds fixed-point inputs for multiple selected points', () => {
    const point1 = createPointApiObject({ id: 10, x: 3, y: 4 })
    const point2 = createPointApiObject({ id: 11, x: 5, y: 6 })
    const objects = createObjectsArray([point1, point2])

    expect(buildFixedConstraintInput([10, 11], objects)).toEqual([
      {
        point: 10,
        position: {
          x: { value: 3, units: 'Mm' },
          y: { value: 4, units: 'Mm' },
        },
      },
      {
        point: 11,
        position: {
          x: { value: 5, units: 'Mm' },
          y: { value: 6, units: 'Mm' },
        },
      },
    ])
  })

  it('returns null unless the selection is one or more points', () => {
    const point1 = createPointApiObject({ id: 10, x: 3, y: 4 })
    const point2 = createPointApiObject({ id: 11, x: 5, y: 6 })
    const line = createLineApiObject({ id: 12, start: 10, end: 11 })
    const objects = createObjectsArray([point1, point2, line])

    expect(buildFixedConstraintInput([], objects)).toBeNull()
    expect(buildFixedConstraintInput([12], objects)).toBeNull()
    expect(buildFixedConstraintInput([10, 12], objects)).toBeNull()
  })
})
