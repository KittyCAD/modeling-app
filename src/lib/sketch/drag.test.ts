import { describe, expect, it } from 'vitest'
import type {
  ApiConstraint,
  ApiObject,
  ApiObjectKind,
  SceneGraph,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  coincidentCluster,
  ctorOf,
  isDraggable,
  planDrag,
} from '@src/lib/sketch/drag'

const at = (id: number, kind: ApiObjectKind): ApiObject => ({
  id,
  kind,
  label: `object${id}`,
  comments: '',
  artifact_id: `artifact-${id}`,
  source: { type: 'Simple', range: [0, 0, 0], node_path: null } as never,
})

const point = (id: number, x: number, y: number) =>
  at(id, {
    type: 'Segment',
    segment: {
      type: 'Point',
      position: { x: { value: x, units: 'Mm' }, y: { value: y, units: 'Mm' } },
      ctor: null,
      owner: null,
      freedom: 'Free',
      constraints: [],
    },
  } as never)

const segment = (id: number, body: Record<string, unknown>) =>
  at(id, {
    type: 'Segment',
    segment: { ctor_applicable: true, construction: false, ...body },
  } as never)

const constraint = (id: number, body: ApiConstraint) =>
  at(id, { type: 'Constraint', constraint: body } as never)

const graphOf = (objects: ApiObject[]) =>
  ({
    project: 0,
    file: 0,
    version: 1,
    objects,
    settings: {},
    sketch_mode: null,
  }) as unknown as SceneGraph

/** A line from (0,0) to (10,0), ids 0–2. */
const line = () =>
  graphOf([
    point(0, 0, 0),
    point(1, 10, 0),
    segment(2, { type: 'Line', start: 0, end: 1 }),
  ])

const dragging = {
  from: { x: 0, y: 0 },
  to: { x: 3, y: 4 },
  units: 'Mm' as const,
}

describe('reading a segment back out of the graph', () => {
  /*
   * From the points, not from the stored constructor: the stored one is what the
   * *source* says, and the points are where the solver has since put them.
   */
  it('builds a line from where its points are now', () => {
    const graph = line()

    expect(ctorOf(graph, graph.objects[2] as ApiObject)).toEqual({
      type: 'Line',
      start: {
        x: { type: 'Var', value: 0, units: 'Mm' },
        y: { type: 'Var', value: 0, units: 'Mm' },
      },
      end: {
        x: { type: 'Var', value: 10, units: 'Mm' },
        y: { type: 'Var', value: 0, units: 'Mm' },
      },
    })
  })

  it('gives up on a segment whose points are missing', () => {
    const graph = graphOf([segment(0, { type: 'Line', start: 7, end: 8 })])

    // A graph mid-renumbering rather than something to paper over.
    expect(ctorOf(graph, graph.objects[0] as ApiObject)).toBeNull()
  })

  it('carries an arc’s sweep direction, which is not derivable', () => {
    const graph = graphOf([
      point(0, 10, 0),
      point(1, 0, 10),
      point(2, 0, 0),
      segment(3, {
        type: 'Arc',
        start: 0,
        end: 1,
        center: 2,
        direction: 'cw',
      }),
    ])

    expect(ctorOf(graph, graph.objects[3] as ApiObject)).toMatchObject({
      type: 'Arc',
      direction: 'cw',
    })
  })
})

describe('dragging a point', () => {
  it('puts it where the pointer is, not where the vector points', () => {
    const plan = planDrag(line(), { id: 1, ...dragging })

    /*
     * The two differ once a solve has been refused or has moved the point
     * somewhere other than where it was asked to go, and the pointer is the
     * authority on where the user wants it.
     */
    expect(plan.edits).toEqual([
      {
        id: 1,
        ctor: {
          type: 'Point',
          position: {
            x: { type: 'Var', value: 3, units: 'Mm' },
            y: { type: 'Var', value: 4, units: 'Mm' },
          },
        },
      },
    ])
  })

  it('needs no anchor: a point is the position being asked for', () => {
    const plan = planDrag(line(), { id: 1, ...dragging })

    expect(plan.anchors).toEqual([])
  })

  /*
   * A corner of a profile is several points at one place. Moving only the one
   * under the cursor asks the solver to break the coincidence, which it can
   * satisfy by moving the *other* segment instead — so the corner tears.
   */
  it('carries every coincident point with it', () => {
    const graph = graphOf([
      point(0, 0, 0),
      point(1, 10, 0),
      segment(2, { type: 'Line', start: 0, end: 1 }),
      point(3, 10, 0),
      point(4, 10, 10),
      segment(5, { type: 'Line', start: 3, end: 4 }),
      constraint(6, { type: 'Coincident', segments: [1, 3] } as ApiConstraint),
    ])

    const plan = planDrag(graph, {
      id: 1,
      from: { x: 10, y: 0 },
      to: { x: 12, y: 0 },
      units: 'Mm',
    })

    expect(plan.edits.map((edit) => edit.id).sort()).toEqual([1, 3])
    // The twin is translated by the vector rather than snapped to the cursor:
    // it is not the thing under the pointer.
    expect(plan.edits.find((edit) => edit.id === 3)).toEqual({
      id: 3,
      ctor: {
        type: 'Point',
        position: {
          x: { type: 'Var', value: 12, units: 'Mm' },
          y: { type: 'Var', value: 0, units: 'Mm' },
        },
      },
    })
  })

  it('follows coincidence through a third point, because it is transitive', () => {
    const graph = graphOf([
      point(0, 0, 0),
      point(1, 0, 0),
      point(2, 0, 0),
      constraint(3, { type: 'Coincident', segments: [0, 1] } as ApiConstraint),
      constraint(4, { type: 'Coincident', segments: [1, 2] } as ApiConstraint),
    ])

    expect([...coincidentCluster(graph, 0)].sort()).toEqual([0, 1, 2])
  })

  it('ignores the origin, which is a literal rather than a point', () => {
    const graph = graphOf([
      point(0, 0, 0),
      constraint(1, {
        type: 'Coincident',
        segments: [0, 'ORIGIN'],
      } as ApiConstraint),
    ])

    expect(coincidentCluster(graph, 0)).toEqual([0])
  })
})

describe('dragging a segment body', () => {
  it('translates every point of it by the same vector', () => {
    const plan = planDrag(line(), { id: 2, ...dragging })

    expect(plan.edits).toEqual([
      {
        id: 2,
        ctor: {
          type: 'Line',
          start: {
            x: { type: 'Var', value: 3, units: 'Mm' },
            y: { type: 'Var', value: 4, units: 'Mm' },
          },
          end: {
            x: { type: 'Var', value: 13, units: 'Mm' },
            y: { type: 'Var', value: 4, units: 'Mm' },
          },
        },
      },
    ])
  })

  /*
   * The anchor is what makes dragging a *constrained* edge work at all:
   * translating its points is a request the constraints may refuse outright,
   * while an anchor asks the solver to slide the segment along whatever freedom
   * it has left so it still passes through the cursor.
   */
  it('asks the solver to keep the body under the cursor', () => {
    const plan = planDrag(line(), { id: 2, ...dragging })

    expect(plan.anchors).toEqual([
      {
        segmentId: 2,
        target: { x: { value: 3, units: 'Mm' }, y: { value: 4, units: 'Mm' } },
      },
    ])
  })

  it('translates a spline without anchoring it', () => {
    const graph = graphOf([
      point(0, 0, 0),
      point(1, 5, 5),
      point(2, 10, 0),
      segment(3, {
        type: 'ControlPointSpline',
        controls: [0, 1, 2],
        degree: 2,
      }),
    ])

    const plan = planDrag(graph, { id: 3, ...dragging })

    // There is no single curve for a control polygon to be held against, which
    // is how the existing app has it too.
    expect(plan.anchors).toEqual([])
    expect(plan.edits[0]?.ctor).toMatchObject({ type: 'ControlPointSpline' })
  })

  /*
   * A line that belongs to something else — a rectangle's side — is placed by
   * its owner, so editing it directly would fight whatever wrote it.
   */
  it('refuses a line that belongs to something else', () => {
    const graph = graphOf([
      point(0, 0, 0),
      point(1, 10, 0),
      segment(2, { type: 'Line', start: 0, end: 1, owner: 9 }),
    ])

    expect(isDraggable(graph, 2)).toBe(false)
    expect(planDrag(graph, { id: 2, ...dragging }).edits).toEqual([])
  })

  it('refuses an id that names nothing', () => {
    expect(planDrag(line(), { id: 42, ...dragging }).edits).toEqual([])
  })
})
