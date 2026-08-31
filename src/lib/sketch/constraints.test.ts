import { describe, expect, it } from 'vitest'
import type {
  ApiObject,
  ApiObjectKind,
  SceneGraph,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  CONSTRAINT_TOOLS,
  classify,
  constraintsFor,
  matchConstraint,
  matcherAccepts,
} from '@src/lib/sketch/constraints'

const at = (id: number, kind: ApiObjectKind): ApiObject => ({
  id,
  kind,
  label: `object${id}`,
  comments: '',
  artifact_id: `artifact-${id}`,
  source: { type: 'Simple', range: [0, 0, 0], node_path: null } as never,
})

const point = (id: number, x = 0, y = 0) =>
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

const constraint = (id: number, type: string) =>
  at(id, {
    type: 'Constraint',
    constraint: { type, lines: [] },
  } as never)

/**
 * Points 0–3, lines 4 and 5, an arc 6, a circle 7, a plain constraint 8 and a
 * dimension 9.
 */
const graph = (): SceneGraph =>
  ({
    objects: [
      point(0, 0, 0),
      point(1, 10, 0),
      point(2, 10, 10),
      point(3, 0, 10),
      segment(4, { type: 'Line', start: 0, end: 1 }),
      segment(5, { type: 'Line', start: 2, end: 3 }),
      segment(6, { type: 'Arc', start: 0, end: 1, center: 2 }),
      segment(7, { type: 'Circle', start: 0, center: 1 }),
      constraint(8, 'Parallel'),
      constraint(9, 'Distance'),
    ],
  }) as unknown as SceneGraph

describe('what a selection is', () => {
  it('names each kind the constraints care about', () => {
    const found = graph()

    expect(classify(found, 0).kind).toBe('point')
    expect(classify(found, 4).kind).toBe('line')
    expect(classify(found, 6).kind).toBe('arc')
    expect(classify(found, 7).kind).toBe('circle')
    expect(classify(found, 'origin').kind).toBe('origin')
  })

  /*
   * A constraint with a value is a different kind of input from a plain
   * geometric one: several tools take a dimension, none takes a parallel.
   */
  it('tells a dimension from a plain constraint', () => {
    expect(classify(graph(), 9).kind).toBe('dimension')
    expect(classify(graph(), 8).kind).toBe('constraint')
  })

  it('says nothing useful about an id that names nothing', () => {
    expect(classify(graph(), 99).kind).toBe('other')
  })

  it('expands the two shorthand matchers', () => {
    expect(matcherAccepts('pointLike', 'origin')).toBe(true)
    expect(matcherAccepts('pointLike', 'point')).toBe(true)
    expect(matcherAccepts('arcLike', 'circle')).toBe(true)
    expect(matcherAccepts('arcLike', 'arc')).toBe(true)
    expect(matcherAccepts('arcLike', 'line')).toBe(false)
    expect(matcherAccepts('line', 'line')).toBe(true)
  })
})

describe('whether a constraint fits', () => {
  it('is complete when every slot is filled', () => {
    expect(matchConstraint('perpendicular', graph(), [4, 5]).status).toBe(
      'complete'
    )
  })

  /*
   * Partial is what makes a tool usable before the selection is finished: it says
   * "keep going" rather than "no".
   */
  it('is partial when a slot is still empty', () => {
    expect(matchConstraint('perpendicular', graph(), [4]).status).toBe(
      'partial'
    )
  })

  it('is invalid when the selection is the wrong shape', () => {
    expect(matchConstraint('perpendicular', graph(), [0, 1]).status).toBe(
      'invalid'
    )
  })

  it('is empty with nothing selected, which is not the same as invalid', () => {
    expect(matchConstraint('perpendicular', graph(), []).status).toBe('empty')
  })

  /*
   * Parallel across five lines is one constraint naming five lines, so the tool
   * has to be able to say "and more of these".
   */
  it('takes any number when the last slot repeats', () => {
    expect(matchConstraint('parallel', graph(), [4, 5, 4, 5, 4]).status).toBe(
      'complete'
    )
  })

  it('picks the mode that matches the order things were picked in', () => {
    expect(matchConstraint('midpoint', graph(), [0, 4]).mode?.id).toBe(
      'point-line'
    )
    expect(matchConstraint('midpoint', graph(), [4, 0]).mode?.id).toBe(
      'line-point'
    )
  })
})

describe('what gets written', () => {
  it('names both selections in a coincidence, origin included', () => {
    expect(constraintsFor('coincident', graph(), [0, 'origin'])).toEqual([
      { type: 'Coincident', segments: [0, 'ORIGIN'] },
    ])
  })

  /*
   * The order the user picked in is the request: a midpoint of a point and a line
   * is not the same statement as a midpoint of a line and a point, and the mode
   * that matched is what records which one was meant.
   */
  it('reads a midpoint the way it was picked', () => {
    expect(constraintsFor('midpoint', graph(), [0, 4])).toEqual([
      { type: 'Midpoint', point: 0, segment: 4 },
    ])
    expect(constraintsFor('midpoint', graph(), [4, 0])).toEqual([
      { type: 'Midpoint', point: 0, segment: 4 },
    ])
  })

  it('will not make the origin a segment', () => {
    // The origin can be the *point* of a midpoint but never the thing it is the
    // middle of.
    expect(constraintsFor('midpoint', graph(), ['origin', 4])).toEqual([
      { type: 'Midpoint', point: 'ORIGIN', segment: 4 },
    ])
  })

  it('makes one constraint from any number of parallel lines', () => {
    expect(constraintsFor('parallel', graph(), [4, 5, 4])).toEqual([
      { type: 'Parallel', lines: [4, 5, 4] },
    ])
  })

  /*
   * Each line is independently horizontal, so several lines are several
   * constraints — unlike parallel, which is one statement about a set.
   */
  it('makes one horizontal per line', () => {
    expect(constraintsFor('horizontal', graph(), [4, 5])).toEqual([
      { type: 'Horizontal', line: 4 },
      { type: 'Horizontal', line: 5 },
    ])
  })

  it('makes a horizontal about two points when that is what was picked', () => {
    expect(constraintsFor('horizontal', graph(), [0, 'origin'])).toEqual([
      { type: 'Horizontal', points: [0, 'ORIGIN'] },
    ])
  })

  /*
   * Two constraints behind one tool: equal *length* for lines and equal *radius*
   * for arcs and circles, decided by what was selected.
   */
  it('splits equal into length and radius', () => {
    expect(constraintsFor('equalLength', graph(), [4, 5])).toEqual([
      { type: 'LinesEqualLength', lines: [4, 5] },
    ])
    expect(constraintsFor('equalLength', graph(), [6, 7])).toEqual([
      { type: 'EqualRadius', input: [6, 7] },
    ])
  })

  it('takes the single line as a symmetric axis, wherever it was picked', () => {
    expect(constraintsFor('symmetric', graph(), [0, 1, 4])).toEqual([
      { type: 'Symmetric', input: [0, 1], axis: 4 },
    ])
    expect(constraintsFor('symmetric', graph(), [0, 4, 1])).toEqual([
      { type: 'Symmetric', input: [0, 1], axis: 4 },
    ])
  })

  /*
   * The existing app refuses this too: with three lines there is no way to guess
   * which is the mirror, and guessing would silently do the wrong thing.
   */
  it('refuses to guess an axis from three lines', () => {
    expect(constraintsFor('symmetric', graph(), [4, 5, 4])).toEqual([])
  })

  it('pins a point where it is, which is a value', () => {
    expect(constraintsFor('fixed', graph(), [1])).toEqual([
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
    ])
  })

  it('writes nothing at all for a selection that does not fit', () => {
    expect(constraintsFor('perpendicular', graph(), [0, 1])).toEqual([])
    expect(constraintsFor('fixed', graph(), [4])).toEqual([])
    expect(constraintsFor('tangent', graph(), [])).toEqual([])
  })
})

describe('the tool table', () => {
  it('gives every tool a name and at least one mode', () => {
    for (const tool of CONSTRAINT_TOOLS) {
      expect(tool.title).toBeTruthy()
      expect(tool.modes.length).toBeGreaterThan(0)
    }
  })

  it('gives every mode at least one slot', () => {
    for (const tool of CONSTRAINT_TOOLS) {
      for (const mode of tool.modes) {
        expect(mode.slots.length).toBeGreaterThan(0)
      }
    }
  })
})
