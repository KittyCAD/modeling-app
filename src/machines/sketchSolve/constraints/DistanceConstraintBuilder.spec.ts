import { DISTANCE_CONSTRAINT_ARROW } from '@src/clientSideScene/sceneConstants'
import { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import {
  getDistanceEndPoints,
  getLineGuideSegment,
} from '@src/machines/sketchSolve/constraints/DistanceConstraintBuilder'
import type { DistanceConstraint } from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  createLineApiObject,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { BufferGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { describe, expect, it } from 'vitest'

describe('ConstraintResources.updateConstraintGroup', () => {
  it('swaps constraint line materials between solid and dashed variants', () => {
    const resources = new ConstraintResources()
    const group = new Group()
    const line = new Line2()
    const arrow = new Mesh(new BufferGeometry(), new MeshBasicMaterial())
    arrow.userData.type = DISTANCE_CONSTRAINT_ARROW

    group.add(line)
    group.add(arrow)

    resources.updateConstraintGroup(group, 1, [], null, 'dashed')
    expect((line.material as any).dashed).toBe(true)
    expect((line.material as any).customProgramCacheKey?.()).toBe(
      'construction-dashed-line'
    )

    resources.updateConstraintGroup(group, 1, [], null, 'solid')
    expect((line.material as any).dashed).toBe(false)
  })
})

describe('getLineGuideSegment', () => {
  const line = {
    start: new Vector3(0, 0, 0),
    end: new Vector3(10, 0, 0),
  }

  it('does not extend a line that reaches the distance endpoint', () => {
    expect(getLineGuideSegment(line, new Vector3(5, 0, 0))).toBeUndefined()
  })

  it('extends from the start when the distance endpoint precedes the line', () => {
    expect(getLineGuideSegment(line, new Vector3(-5, 0, 0))).toEqual([
      line.start,
      new Vector3(-5, 0, 0),
    ])
  })

  it('extends from the end when the distance endpoint follows the line', () => {
    expect(getLineGuideSegment(line, new Vector3(15, 0, 0))).toEqual([
      line.end,
      new Vector3(15, 0, 0),
    ])
  })
})

describe('getDistanceEndPoints', () => {
  const constraint = {
    id: 20,
    kind: {
      type: 'Constraint',
      constraint: {
        type: 'Distance',
        segments: [10, 11],
        distance: { value: 10, units: 'Mm' },
        source: { expr: '10', is_literal: true },
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  } as DistanceConstraint

  it('starts each parallel-line leader on its finite segment', () => {
    const objects = createSceneGraphDelta([
      createPointApiObject({ id: 1, x: 0, y: 10 }),
      createPointApiObject({ id: 2, x: 10, y: 10 }),
      createPointApiObject({ id: 3, x: 5, y: 0 }),
      createPointApiObject({ id: 4, x: 10, y: 0 }),
      createLineApiObject({ id: 10, start: 1, end: 2 }),
      createLineApiObject({ id: 11, start: 3, end: 4 }),
    ]).new_graph.objects

    expect(getDistanceEndPoints(constraint, objects)).toMatchObject({
      p1: new Vector3(0, 10, 0),
      p2: new Vector3(0, 0, 0),
      leaderStart1: new Vector3(0, 10, 0),
      leaderStart2: new Vector3(5, 0, 0),
    })
  })

  it('starts both leaders at the measurement points when the lines reach them', () => {
    const objects = createSceneGraphDelta([
      createPointApiObject({ id: 1, x: 5, y: 10 }),
      createPointApiObject({ id: 2, x: 10, y: 10 }),
      createPointApiObject({ id: 3, x: 0, y: 0 }),
      createPointApiObject({ id: 4, x: 10, y: 0 }),
      createLineApiObject({ id: 10, start: 1, end: 2 }),
      createLineApiObject({ id: 11, start: 3, end: 4 }),
    ]).new_graph.objects

    expect(getDistanceEndPoints(constraint, objects)).toMatchObject({
      p1: new Vector3(5, 10, 0),
      p2: new Vector3(5, 0, 0),
      leaderStart1: new Vector3(5, 10, 0),
      leaderStart2: new Vector3(5, 0, 0),
    })
  })

  it('aligns the measurement points with the label without overextending', () => {
    const objects = createSceneGraphDelta([
      createPointApiObject({ id: 1, x: 0, y: 10 }),
      createPointApiObject({ id: 2, x: 10, y: 10 }),
      createPointApiObject({ id: 3, x: 5, y: 0 }),
      createPointApiObject({ id: 4, x: 12, y: 0 }),
      createLineApiObject({ id: 10, start: 1, end: 2 }),
      createLineApiObject({ id: 11, start: 3, end: 4 }),
    ]).new_graph.objects
    const labelConstraint = {
      ...constraint,
      kind: {
        ...constraint.kind,
        constraint: {
          ...constraint.kind.constraint,
          labelPosition: {
            x: { value: 3, units: 'Mm' },
            y: { value: 5, units: 'Mm' },
          },
        },
      },
    } as DistanceConstraint

    expect(getDistanceEndPoints(labelConstraint, objects)).toMatchObject({
      p1: new Vector3(3, 10, 0),
      p2: new Vector3(3, 0, 0),
      leaderStart1: new Vector3(3, 10, 0),
      leaderStart2: new Vector3(5, 0, 0),
    })
  })
})
