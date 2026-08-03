import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { buildDraftLineConstraintPlan } from '@src/machines/sketchSolve/tools/draftLineConstraint'
import {
  createLineApiObject,
  createPointApiObject,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { describe, expect, it } from 'vitest'

function createConstraintApiObject(
  id: number,
  constraint: ApiConstraint
): ApiObject {
  return {
    id,
    kind: { type: 'Constraint', constraint },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function createObjectsArray(objects: ApiObject[]) {
  const array: ApiObject[] = []
  for (const object of objects) {
    array[object.id] = object
  }
  return array
}

const start = createPointApiObject({ id: 1, x: 0, y: 0 })
const end = createPointApiObject({ id: 2, x: 10, y: 5 })
const draftLine = createLineApiObject({ id: 10, start: 1, end: 2 })
const draftEntities = {
  segmentIds: [1, 2, 10],
  constraintIds: [30],
}

describe('buildDraftLineConstraintPlan', () => {
  it('returns null for tools other than the orientation constraint tools', () => {
    const objects = createObjectsArray([start, end, draftLine])

    expect(
      buildDraftLineConstraintPlan('lineTool', draftEntities, objects)
    ).toBeNull()
    expect(
      buildDraftLineConstraintPlan(
        'parallelConstraintTool',
        draftEntities,
        objects
      )
    ).toBeNull()
  })

  it('returns null when there are no draft entities or no draft line', () => {
    const objects = createObjectsArray([start, end, draftLine])

    expect(
      buildDraftLineConstraintPlan('verticalConstraintTool', undefined, objects)
    ).toBeNull()
    expect(
      buildDraftLineConstraintPlan(
        'verticalConstraintTool',
        { segmentIds: [1, 2], constraintIds: [] },
        objects
      )
    ).toBeNull()
  })

  it('adds an orientation constraint to the draft line when none exists', () => {
    const objects = createObjectsArray([start, end, draftLine])

    expect(
      buildDraftLineConstraintPlan(
        'verticalConstraintTool',
        draftEntities,
        objects
      )
    ).toEqual({
      deleteConstraintIds: [],
      constraint: { type: 'Vertical', line: 10 },
    })
    expect(
      buildDraftLineConstraintPlan(
        'horizontalConstraintTool',
        draftEntities,
        objects
      )
    ).toEqual({
      deleteConstraintIds: [],
      constraint: { type: 'Horizontal', line: 10 },
    })
  })

  it('toggles the constraint off when the same orientation is requested again', () => {
    const vertical = createConstraintApiObject(20, {
      type: 'Vertical',
      line: 10,
    })
    const objects = createObjectsArray([start, end, draftLine, vertical])

    expect(
      buildDraftLineConstraintPlan(
        'verticalConstraintTool',
        draftEntities,
        objects
      )
    ).toEqual({
      deleteConstraintIds: [20],
      constraint: null,
    })
  })

  it('swaps the constraint when the opposite orientation is requested', () => {
    const horizontal = createConstraintApiObject(20, {
      type: 'Horizontal',
      line: 10,
    })
    const objects = createObjectsArray([start, end, draftLine, horizontal])

    expect(
      buildDraftLineConstraintPlan(
        'verticalConstraintTool',
        draftEntities,
        objects
      )
    ).toEqual({
      deleteConstraintIds: [20],
      constraint: { type: 'Vertical', line: 10 },
    })
  })

  it('ignores orientation constraints on other lines and point-based ones', () => {
    const otherStart = createPointApiObject({ id: 3, x: 20, y: 0 })
    const otherEnd = createPointApiObject({ id: 4, x: 20, y: 10 })
    const otherLine = createLineApiObject({ id: 11, start: 3, end: 4 })
    const verticalOnOtherLine = createConstraintApiObject(20, {
      type: 'Vertical',
      line: 11,
    })
    const verticalOnPoints = createConstraintApiObject(21, {
      type: 'Vertical',
      points: [1, 'ORIGIN'],
    })
    const objects = createObjectsArray([
      start,
      end,
      otherStart,
      otherEnd,
      draftLine,
      otherLine,
      verticalOnOtherLine,
      verticalOnPoints,
    ])

    expect(
      buildDraftLineConstraintPlan(
        'verticalConstraintTool',
        draftEntities,
        objects
      )
    ).toEqual({
      deleteConstraintIds: [],
      constraint: { type: 'Vertical', line: 10 },
    })
  })
})
