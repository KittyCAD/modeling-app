import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { calculateArcRenderInput } from '@src/machines/sketchSolve/constraints/AngleConstraintBuilder'
import {
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

function createAngleConstraintApiObject({
  id,
  lines,
  angle,
  rays,
  sector,
}: {
  id: number
  lines: [number, number]
  angle: number
  rays?: ['forward' | 'reverse', 'forward' | 'reverse']
  sector?: 'primary' | 'opposite' | 'Primary' | 'Opposite'
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Constraint',
      constraint: {
        type: 'Angle',
        lines,
        angle: { value: angle, units: 'Deg' },
        rays,
        sector: sector as 'primary' | 'opposite' | undefined,
        source: { expr: `${angle}deg`, is_literal: true },
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function normalize([x, y]: [number, number]): [number, number] {
  const length = Math.hypot(x, y)
  return [x / length, y / length]
}

function cross(a: [number, number], b: [number, number]) {
  return a[0] * b[1] - a[1] * b[0]
}

function dot(a: [number, number], b: [number, number]) {
  return a[0] * b[0] + a[1] * b[1]
}

describe('calculateArcRenderInput', () => {
  it('uses angle rays and opposite sector for deterministic rendering', () => {
    const origin = createPointApiObject({ id: 1, x: 0, y: 0 })
    const east = createPointApiObject({ id: 2, x: 10, y: 0 })
    const north = createPointApiObject({ id: 3, x: 0, y: 10 })
    const horizontalLine = createLineApiObject({ id: 10, start: 1, end: 2 })
    const verticalLine = createLineApiObject({ id: 11, start: 1, end: 3 })
    const angleConstraint = createAngleConstraintApiObject({
      id: 20,
      lines: [10, 11],
      angle: 270,
      rays: ['forward', 'forward'],
      sector: 'opposite',
    })
    const objects = createObjectsArray([
      origin,
      east,
      north,
      horizontalLine,
      verticalLine,
      angleConstraint,
    ])

    const renderInput = calculateArcRenderInput(angleConstraint, objects, 1)

    expect(renderInput).not.toBeNull()
    expect(renderInput?.line1).toEqual([
      [0, 0],
      [0, 10],
    ])
    expect(renderInput?.line2).toEqual([
      [0, 0],
      [10, 0],
    ])
    expect(renderInput?.startAngle).toBeCloseTo(Math.PI / 2)
    expect(renderInput?.sweepAngle).toBeCloseTo((3 * Math.PI) / 2)
  })

  it('accepts runtime-capitalized opposite sector metadata', () => {
    const origin = createPointApiObject({ id: 1, x: 0, y: 0 })
    const east = createPointApiObject({ id: 2, x: 10, y: 0 })
    const north = createPointApiObject({ id: 3, x: 0, y: 10 })
    const horizontalLine = createLineApiObject({ id: 10, start: 1, end: 2 })
    const verticalLine = createLineApiObject({ id: 11, start: 1, end: 3 })
    const angleConstraint = createAngleConstraintApiObject({
      id: 20,
      lines: [10, 11],
      angle: 270,
      rays: ['forward', 'forward'],
      sector: 'Opposite',
    })
    const objects = createObjectsArray([
      origin,
      east,
      north,
      horizontalLine,
      verticalLine,
      angleConstraint,
    ])

    const renderInput = calculateArcRenderInput(angleConstraint, objects, 1)

    expect(renderInput?.sweepAngle).toBeCloseTo((3 * Math.PI) / 2)
  })

  it('uses the major angle value even if sector metadata is primary', () => {
    const origin = createPointApiObject({ id: 1, x: 0, y: 0 })
    const east = createPointApiObject({ id: 2, x: 10, y: 0 })
    const north = createPointApiObject({ id: 3, x: 0, y: 10 })
    const horizontalLine = createLineApiObject({ id: 10, start: 1, end: 2 })
    const verticalLine = createLineApiObject({ id: 11, start: 1, end: 3 })
    const angleConstraint = createAngleConstraintApiObject({
      id: 20,
      lines: [10, 11],
      angle: 270,
      rays: ['forward', 'forward'],
      sector: 'primary',
    })
    const objects = createObjectsArray([
      origin,
      east,
      north,
      horizontalLine,
      verticalLine,
      angleConstraint,
    ])

    const renderInput = calculateArcRenderInput(angleConstraint, objects, 1)

    expect(renderInput?.sweepAngle).toBeCloseTo((3 * Math.PI) / 2)
  })

  it('uses the minor angle value even if sector metadata is opposite', () => {
    const origin = createPointApiObject({ id: 1, x: 0, y: 0 })
    const east = createPointApiObject({ id: 2, x: 10, y: 0 })
    const north = createPointApiObject({ id: 3, x: 0, y: 10 })
    const horizontalLine = createLineApiObject({ id: 10, start: 1, end: 2 })
    const verticalLine = createLineApiObject({ id: 11, start: 1, end: 3 })
    const angleConstraint = createAngleConstraintApiObject({
      id: 20,
      lines: [10, 11],
      angle: 90,
      rays: ['forward', 'forward'],
      sector: 'opposite',
    })
    const objects = createObjectsArray([
      origin,
      east,
      north,
      horizontalLine,
      verticalLine,
      angleConstraint,
    ])

    const renderInput = calculateArcRenderInput(angleConstraint, objects, 1)

    expect(renderInput?.sweepAngle).toBeCloseTo(Math.PI / 2)
  })

  it('keeps the opposite-sector endpoint on the second selected ray', () => {
    const line1StartCoords: [number, number] = [-3.33, -5.54]
    const line1EndCoords: [number, number] = [-2.38, 5.02]
    const line2StartCoords: [number, number] = [-3.79, -3.55]
    const line2EndCoords: [number, number] = [6.06, 0.95]
    const line1Start = createPointApiObject({
      id: 1,
      x: line1StartCoords[0],
      y: line1StartCoords[1],
    })
    const line1End = createPointApiObject({
      id: 2,
      x: line1EndCoords[0],
      y: line1EndCoords[1],
    })
    const line2Start = createPointApiObject({
      id: 3,
      x: line2StartCoords[0],
      y: line2StartCoords[1],
    })
    const line2End = createPointApiObject({
      id: 4,
      x: line2EndCoords[0],
      y: line2EndCoords[1],
    })
    const line1 = createLineApiObject({ id: 10, start: 1, end: 2 })
    const line2 = createLineApiObject({ id: 11, start: 3, end: 4 })
    const angleConstraint = createAngleConstraintApiObject({
      id: 20,
      lines: [11, 10],
      angle: 360 - 60.28,
      rays: ['forward', 'forward'],
      sector: 'opposite',
    })
    const objects = createObjectsArray([
      line1Start,
      line1End,
      line2Start,
      line2End,
      line1,
      line2,
      angleConstraint,
    ])

    const renderInput = calculateArcRenderInput(angleConstraint, objects, 1)
    expect(renderInput).not.toBeNull()
    if (!renderInput) {
      return
    }

    const endAngle = renderInput.startAngle + renderInput.sweepAngle
    const endDirection = normalize([Math.cos(endAngle), Math.sin(endAngle)])
    const expectedEndDirection = normalize([
      line2EndCoords[0] - line2StartCoords[0],
      line2EndCoords[1] - line2StartCoords[1],
    ])

    expect(cross(endDirection, expectedEndDirection)).toBeCloseTo(0)
    expect(dot(endDirection, expectedEndDirection)).toBeGreaterThan(0)
  })

  it('uses the major angle value if sector metadata is missing', () => {
    const origin = createPointApiObject({ id: 1, x: 0, y: 0 })
    const east = createPointApiObject({ id: 2, x: 10, y: 0 })
    const north = createPointApiObject({ id: 3, x: 0, y: 10 })
    const horizontalLine = createLineApiObject({ id: 10, start: 1, end: 2 })
    const verticalLine = createLineApiObject({ id: 11, start: 1, end: 3 })
    const angleConstraint = createAngleConstraintApiObject({
      id: 20,
      lines: [10, 11],
      angle: 270,
      rays: ['forward', 'forward'],
    })
    const objects = createObjectsArray([
      origin,
      east,
      north,
      horizontalLine,
      verticalLine,
      angleConstraint,
    ])

    const renderInput = calculateArcRenderInput(angleConstraint, objects, 1)

    expect(renderInput?.sweepAngle).toBeCloseTo((3 * Math.PI) / 2)
  })
})
