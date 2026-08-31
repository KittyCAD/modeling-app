import { describe, expect, it } from 'vitest'
import type {
  ApiObject,
  ApiObjectKind,
  SceneGraph,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { dimensionFor, dimensionsOf } from '@src/lib/sketch/dimensions'

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

const line = (id: number, start: number, end: number) =>
  at(id, {
    type: 'Segment',
    segment: {
      type: 'Line',
      start,
      end,
      ctor_applicable: true,
      construction: false,
    },
  } as never)

/**
 * The sketch is put at the index that equals its id, because an object's id *is*
 * its index in the graph and every lookup checks that.
 */
const SKETCH_ID = 20

const graphOf = (objects: ApiObject[], constraints: number[] = []) => {
  const all: ApiObject[] = [...objects]
  all[SKETCH_ID] = at(SKETCH_ID, {
    type: 'Sketch',
    args: { on: { default: 'XY' } },
    plane: 99,
    segments: [],
    constraints,
  } as never)

  return { objects: all } as unknown as SceneGraph
}

/**
 * Points 0 (0,0), 1 (30,0), 2 (0,10), 3 (30,10), and three lines: 4 along the
 * bottom, 5 along the top (parallel to it), 6 up the left side.
 */
const shapes = () =>
  graphOf([
    point(0, 0, 0),
    point(1, 30, 0),
    point(2, 0, 10),
    point(3, 30, 10),
    line(4, 0, 1),
    line(5, 2, 3),
    line(6, 0, 2),
  ])

describe('what a selection dimensions', () => {
  it('measures between two points', () => {
    const found = dimensionFor(shapes(), [0, 1], 'Mm')

    expect(found?.constraint).toEqual({
      type: 'Distance',
      segments: [0, 1],
      distance: { value: 30, units: 'Mm' },
      labelPosition: {
        x: { value: 15, units: 'Mm' },
        y: { value: 0, units: 'Mm' },
      },
      source: { expr: '30', is_literal: true },
    })
  })

  it('measures from the origin, which is a point like any other', () => {
    const found = dimensionFor(shapes(), ['origin', 1], 'Mm')

    expect(found?.constraint).toMatchObject({
      type: 'Distance',
      segments: ['ORIGIN', 1],
      distance: { value: 30, units: 'Mm' },
    })
  })

  it('measures a point against a line', () => {
    const found = dimensionFor(shapes(), [2, 4], 'Mm')

    // Ten millimetres above the bottom edge.
    expect(found?.constraint).toMatchObject({
      type: 'Distance',
      segments: [2, 4],
      distance: { value: 10, units: 'Mm' },
    })
  })

  it('measures the gap between two parallel lines', () => {
    const found = dimensionFor(shapes(), [4, 5], 'Mm')

    expect(found?.constraint).toMatchObject({
      type: 'Distance',
      segments: [4, 5],
      distance: { value: 10, units: 'Mm' },
    })
  })

  /*
   * Two lines that are not parallel have no distance between them, so what was
   * being asked for is the angle.
   */
  it('measures the angle between two lines that cross', () => {
    const found = dimensionFor(shapes(), [4, 6], 'Mm')

    expect(found?.constraint).toMatchObject({
      type: 'Angle',
      lines: [4, 6],
      angle: { value: 90, units: 'Deg' },
    })
  })

  it('writes the value as a literal expression, which is what a file holds', () => {
    const found = dimensionFor(shapes(), [4, 6], 'Mm')

    expect(found?.constraint).toMatchObject({
      source: { expr: '90deg', is_literal: true },
    })
  })

  it('needs exactly two things', () => {
    expect(dimensionFor(shapes(), [0], 'Mm')).toBeNull()
    expect(dimensionFor(shapes(), [0, 1, 2], 'Mm')).toBeNull()
    expect(dimensionFor(shapes(), [], 'Mm')).toBeNull()
  })

  /*
   * A dimension of zero is not a dimension: it pins two things on top of each
   * other, which is a coincidence, and the solver has no direction to work with.
   */
  it('refuses a distance of nothing', () => {
    const same = graphOf([point(0, 5, 5), point(1, 5, 5)])

    expect(dimensionFor(same, [0, 1], 'Mm')).toBeNull()
  })

  it('has nothing to say about a selection it does not understand', () => {
    expect(dimensionFor(shapes(), [99, 98], 'Mm')).toBeNull()
  })

  it('puts the label between the two things', () => {
    expect(dimensionFor(shapes(), [0, 1], 'Mm')?.labelAt).toEqual({
      x: 15,
      y: 0,
    })
  })
})

describe('reading the dimensions in a sketch', () => {
  const withDistance = () =>
    graphOf(
      [
        point(0, 0, 0),
        point(1, 30, 0),
        at(2, {
          type: 'Constraint',
          constraint: {
            type: 'Distance',
            segments: [0, 1],
            distance: { value: 30, units: 'Mm' },
            labelPosition: {
              x: { value: 15, units: 'Mm' },
              y: { value: 4, units: 'Mm' },
            },
            source: { expr: '30', is_literal: true },
          },
        } as never),
        at(3, {
          type: 'Constraint',
          constraint: { type: 'Parallel', lines: [0, 1] },
        } as never),
      ],
      [2, 3]
    )

  it('reports the value and where its label sits', () => {
    expect(dimensionsOf(withDistance(), SKETCH_ID)).toEqual([
      {
        id: 2,
        value: 30,
        units: 'Mm',
        at: { x: 15, y: 4 },
        type: 'Distance',
      },
    ])
  })

  /*
   * A parallel is a constraint but not a dimension: there is no number to show
   * and nothing to type over.
   */
  it('leaves out the constraints that carry no value', () => {
    expect(dimensionsOf(withDistance(), SKETCH_ID)).toHaveLength(1)
  })

  it('says nothing for an id that is not a sketch', () => {
    expect(dimensionsOf(withDistance(), 0)).toEqual([])
  })
})
