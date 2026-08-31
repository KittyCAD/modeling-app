import { describe, expect, it } from 'vitest'
import type {
  ApiConstraint,
  ApiObject,
  ApiObjectKind,
  SceneGraph,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { badgesOf } from '@src/lib/sketch/badges'

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

const SKETCH_ID = 30

/** Points 0 (0,0) and 1 (10,0), line 2 between them, then constraints from 3. */
const graphWith = (constraints: readonly ApiConstraint[]) => {
  const objects: ApiObject[] = [point(0, 0, 0), point(1, 10, 0), line(2, 0, 1)]
  const ids: number[] = []

  for (const [index, constraint] of constraints.entries()) {
    const id = 3 + index
    objects[id] = at(id, { type: 'Constraint', constraint } as never)
    ids.push(id)
  }

  objects[SKETCH_ID] = at(SKETCH_ID, {
    type: 'Sketch',
    args: { on: { default: 'XY' } },
    plane: 99,
    segments: [0, 1, 2],
    constraints: ids,
  } as never)

  return { objects } as unknown as SceneGraph
}

describe('where a constraint is drawn', () => {
  /*
   * Millimetres, like the drawing's, because that is the unit the plane frame and
   * the camera are in. The fixture is written in millimetres, so the numbers pass
   * straight through — a file in inches would not.
   */
  it('converts a position written in another unit', () => {
    const inches: ApiObject[] = [
      at(0, {
        type: 'Segment',
        segment: {
          type: 'Point',
          position: {
            x: { value: 1, units: 'Inch' },
            y: { value: 0, units: 'Inch' },
          },
          ctor: null,
          owner: null,
          freedom: 'Free',
          constraints: [],
        },
      } as never),
      at(1, {
        type: 'Constraint',
        constraint: {
          type: 'Fixed',
          points: [
            {
              point: 0,
              position: {
                x: { value: 1, units: 'Inch' },
                y: { value: 0, units: 'Inch' },
              },
            },
          ],
        },
      } as never),
    ]
    inches[SKETCH_ID] = at(SKETCH_ID, {
      type: 'Sketch',
      args: { on: { default: 'XY' } },
      plane: 99,
      segments: [0],
      constraints: [1],
    } as never)

    const found = badgesOf(
      { objects: inches } as unknown as SceneGraph,
      SKETCH_ID
    )

    expect(found[0]?.at.x).toBeCloseTo(25.4)
  })

  it('puts a coincidence on the first point it names', () => {
    const found = badgesOf(
      graphWith([{ type: 'Coincident', segments: [1, 0] }]),
      SKETCH_ID
    )

    expect(found).toEqual([
      { id: 3, at: { x: 10, y: 0 }, icon: 'coincident', title: 'Coincident' },
    ])
  })

  it('puts a horizontal on the middle of its line', () => {
    const found = badgesOf(
      graphWith([{ type: 'Horizontal', line: 2 }]),
      SKETCH_ID
    )

    expect(found[0]?.at).toEqual({ x: 5, y: 0 })
    expect(found[0]?.icon).toBe('horizontal')
  })

  it('puts a fixed constraint on the point it pins', () => {
    const found = badgesOf(
      graphWith([
        {
          type: 'Fixed',
          points: [
            {
              point: 1,
              position: {
                x: { value: 10, units: 'Mm' },
                y: { value: 0, units: 'Mm' },
              },
            },
          ],
        },
      ]),
      SKETCH_ID
    )

    expect(found[0]?.at).toEqual({ x: 10, y: 0 })
    expect(found[0]?.icon).toBe('fix')
  })

  it('reads the origin as the origin, not as a missing object', () => {
    const found = badgesOf(
      graphWith([{ type: 'Coincident', segments: ['ORIGIN', 1] }]),
      SKETCH_ID
    )

    expect(found[0]?.at).toEqual({ x: 0, y: 0 })
  })

  /*
   * A dimension is the same kind of object in the graph but a different thing on
   * screen: it is drawn as its value, at the label position it carries.
   */
  it('leaves the dimensions to be drawn as values', () => {
    const found = badgesOf(
      graphWith([
        {
          type: 'Distance',
          segments: [0, 1],
          distance: { value: 10, units: 'Mm' },
          source: { expr: '10', is_literal: true },
        },
      ]),
      SKETCH_ID
    )

    expect(found).toEqual([])
  })

  it('skips a constraint whose geometry has gone', () => {
    const found = badgesOf(
      graphWith([{ type: 'Horizontal', line: 77 }]),
      SKETCH_ID
    )

    // A graph mid-renumbering rather than something to draw at the origin.
    expect(found).toEqual([])
  })

  it('says nothing for an id that is not a sketch', () => {
    expect(badgesOf(graphWith([]), 0)).toEqual([])
  })
})
