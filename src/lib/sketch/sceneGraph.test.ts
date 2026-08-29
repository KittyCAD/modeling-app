import type {
  ApiObject,
  Freedom,
  SceneGraph,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { describe, expect, it } from 'vitest'
import {
  activeSketch,
  constraintsOf,
  objectAt,
  pointAt,
  segmentAt,
  segmentsOf,
  sketchIdAt,
  sketchRanges,
} from '@src/lib/sketch/sceneGraph'

const at = (id: number, kind: ApiObject['kind']): ApiObject => ({
  id,
  kind,
  label: `object${id}`,
  comments: '',
  artifact_id: `artifact-${id}`,
  source: { type: 'Simple', range: [0, 0, 0], node_path: null } as never,
})

const point = (id: number, x: number, y: number, freedom: Freedom = 'Free') =>
  at(id, {
    type: 'Segment',
    segment: {
      type: 'Point',
      position: { x: { value: x, units: 'Mm' }, y: { value: y, units: 'Mm' } },
      ctor: null,
      owner: null,
      freedom,
      constraints: [],
    },
  } as never)

const line = (id: number, start: number, end: number) =>
  at(id, {
    type: 'Segment',
    segment: {
      type: 'Line',
      start,
      end,
      ctor: { type: 'Line' },
      ctor_applicable: true,
      construction: false,
    },
  } as never)

const graphOf = (objects: ApiObject[], sketchMode: number | null = 5) =>
  ({
    project: 0,
    file: 0,
    version: 1,
    objects,
    settings: {},
    sketch_mode: sketchMode,
  }) as unknown as SceneGraph

/** ids 0..2 points, 3..4 lines, 5 the sketch, 6 a constraint. */
const graph = graphOf([
  point(0, 0, 0, 'Fixed'),
  point(1, 5, 0),
  point(2, 5, 5, 'Conflict'),
  line(3, 0, 1),
  line(4, 1, 2),
  at(5, {
    type: 'Sketch',
    args: { on: { default: 'XY' } },
    plane: 9,
    segments: [3, 4],
    constraints: [6],
  } as never),
  at(6, {
    type: 'Constraint',
    constraint: { type: 'Coincident', segments: [3, 4] },
  } as never),
])

describe('finding objects by id', () => {
  it('reads the object at its own index', () => {
    expect(objectAt(graph, 3)?.kind.type).toBe('Segment')
  })

  /* A stale id after a renumbering would otherwise read as its new occupant. */
  it('refuses an object whose id does not match its slot', () => {
    const shifted = graphOf([point(7, 0, 0)])

    expect(objectAt(shifted, 0)).toBeUndefined()
  })

  it('is undefined past the end', () => {
    expect(objectAt(graph, 99)).toBeUndefined()
  })
})

describe('the sketch being edited', () => {
  it('is the one the graph names', () => {
    expect(activeSketch(graph)?.id).toBe(5)
  })

  it('is nothing when no session is open', () => {
    expect(activeSketch(graphOf([...graph.objects], null))).toBeUndefined()
  })

  it('is nothing when the named object is not a sketch', () => {
    expect(activeSketch(graphOf([...graph.objects], 3))).toBeUndefined()
  })
})

describe('resolving a point', () => {
  it('reads its position as plain numbers', () => {
    expect(pointAt(graph, 1)).toEqual({
      id: 1,
      x: 5,
      y: 0,
      // The unit travels with the numbers: a drawing needs millimetres and a
      // readout needs whatever the file was written in.
      units: 'Mm',
      freedom: 'Free',
    })
  })

  it('is nothing for a segment that is not a point', () => {
    expect(pointAt(graph, 3)).toBeNull()
  })
})

describe('resolving a segment', () => {
  it('resolves a line to its two points, in order', () => {
    const resolved = segmentAt(graph, 3)

    expect(resolved?.points.map((p) => p.id)).toEqual([0, 1])
    expect(resolved?.construction).toBe(false)
  })

  /* A point is a segment in its own right — it is how a placed point is held. */
  it('resolves a standalone point to itself', () => {
    const resolved = segmentAt(graph, 1)

    expect(resolved?.points.map((p) => p.id)).toEqual([1])
    expect(resolved?.freedom).toBe('Free')
  })

  it('is nothing for a sketch or a constraint', () => {
    expect(segmentAt(graph, 5)).toBeNull()
    expect(segmentAt(graph, 6)).toBeNull()
  })

  it('drops a point the graph has lost rather than inventing one', () => {
    const broken = graphOf([point(0, 0, 0), line(1, 0, 42)])

    expect(segmentAt(broken, 1)?.points.map((p) => p.id)).toEqual([0])
  })
})

describe('how constrained a segment is', () => {
  it('is fixed only when all of it is', () => {
    expect(segmentAt(graph, 3)?.freedom).toBe('Free')
  })

  it('is in conflict when any of it is', () => {
    expect(segmentAt(graph, 4)?.freedom).toBe('Conflict')
  })

  it('is fixed when every point is', () => {
    const fixed = graphOf([
      point(0, 0, 0, 'Fixed'),
      point(1, 1, 1, 'Fixed'),
      line(2, 0, 1),
    ])

    expect(segmentAt(fixed, 2)?.freedom).toBe('Fixed')
  })
})

describe('reading a sketch', () => {
  /* The sketch names its own segments: a file with three sketches has three. */
  it('follows the sketch list rather than the whole graph', () => {
    expect(segmentsOf(graph, 5).map((s) => s.id)).toEqual([3, 4])
  })

  it('has nothing for an id that is not a sketch', () => {
    expect(segmentsOf(graph, 3)).toEqual([])
  })

  it('reads the constraints too', () => {
    expect(constraintsOf(graph, 5).map((c) => c.id)).toEqual([6])
  })
})

/*
 * The two ways this app names a sketch: our side has a text range, the frontend
 * has an object id, and every object carries the source it came from.
 */
describe('finding a sketch by where it is written', () => {
  const sketchAt = (id: number, from: number, to: number): ApiObject => ({
    ...at(id, {
      type: 'Sketch',
      args: { on: { default: 'XY' } },
      plane: 99,
      segments: [],
      constraints: [],
    } as never),
    source: { type: 'Simple', range: [from, to, 0], node_path: null } as never,
  })

  const written = graphOf([sketchAt(0, 10, 60), sketchAt(1, 100, 160)])

  it('names the sketch the offset is inside', () => {
    expect(sketchIdAt(written, 30)).toBe(0)
    expect(sketchIdAt(written, 120)).toBe(1)
  })

  it('counts the whole statement, ends included', () => {
    expect(sketchIdAt(written, 10)).toBe(0)
    expect(sketchIdAt(written, 60)).toBe(0)
  })

  it('is nothing between them', () => {
    expect(sketchIdAt(written, 80)).toBeNull()
  })

  /* The smallest range containing the offset is the one the cursor is in. */
  it('prefers the innermost when ranges nest', () => {
    const nested = graphOf([sketchAt(0, 0, 200), sketchAt(1, 20, 40)])

    expect(sketchIdAt(nested, 30)).toBe(1)
  })

  it('ignores objects that are not sketches', () => {
    // The segments and constraints of the base graph all sit at offset zero.
    const noSketches = graphOf([point(0, 0, 0), line(1, 0, 0)])

    expect(sketchIdAt(noSketches, 0)).toBeNull()
  })
})

describe('sketchRanges', () => {
  it('reads a sketch that came through a call, not just a simple one', () => {
    // A `BackTrace` source carries every range on the way in; the last is the
    // one nearest the sketch itself. Skipping these was a silent hole.
    const traced = graphOf([
      at(0, {
        type: 'Sketch',
        args: { on: { default: 'XY' } },
        plane: 9,
        segments: [],
        constraints: [],
      } as never),
    ])
    const object = traced.objects[0]
    if (object) {
      object.source = {
        type: 'BackTrace',
        ranges: [
          [[100, 200, 0], null],
          [[140, 160, 0], null],
        ],
      } as never
    }

    expect(sketchRanges(traced)).toEqual([{ id: 0, range: [140, 160] }])
    expect(sketchIdAt(traced, 150)).toBe(0)
    expect(sketchIdAt(traced, 110)).toBeNull()
  })
})
