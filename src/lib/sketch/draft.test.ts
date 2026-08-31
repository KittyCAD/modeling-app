import { describe, expect, it } from 'vitest'
import {
  ARC_SEGMENT_LABEL,
  CIRCLE_SEGMENT_LABEL,
  LINE_SEGMENT_LABEL,
  POINT_SEGMENT_LABEL,
  abandon,
  advanceDrag,
  beginDrag,
  draftSegmentIds,
  endDrag,
  expr,
  isMidDraft,
  circleFrom,
  moveTo,
  place,
  pointSegment,
  roundOff,
  zeroLengthLine,
} from '@src/lib/sketch/draft'

const context = { tool: 'line' as const, units: 'Mm' as const }
const idle = { kind: 'idle' as const }
const drawing = {
  kind: 'drawing' as const,
  pointId: 7,
  segmentIds: [5, 6, 7],
}

describe('the first click', () => {
  /*
   * The whole idea: the click writes a segment rather than remembering a
   * position, so the rubber band is real geometry from the outset.
   */
  it('writes a zero-length line', () => {
    const step = place(idle, { x: 3, y: 4 }, context)

    expect(step.actions).toEqual([
      {
        kind: 'begin',
        segment: zeroLengthLine({ x: 3, y: 4 }, 'Mm'),
        label: LINE_SEGMENT_LABEL,
        hold: { kind: 'end' },
      },
    ])

    const [action] = step.actions
    if (action?.kind !== 'begin' || action.segment.type !== 'Line') {
      throw new Error('expected a line')
    }
    // Both ends in the same place, ready to be dragged open.
    expect(action.segment.start).toEqual(action.segment.end)
  })

  it('leaves the state alone until the frontend answers with an id', () => {
    expect(place(idle, { x: 0, y: 0 }, context).state).toEqual(idle)
  })
})

describe('moving the pointer', () => {
  it('drags the draft as a preview, not as an edit', () => {
    // Settling the guesses on every move would leave a trail of committed
    // positions from wherever the pointer happened to pass.
    expect(moveTo(drawing, { x: 9, y: 9 }, context).actions).toEqual([
      { kind: 'move', pointId: 7, to: { x: 9, y: 9 }, commit: false },
    ])
  })

  it('does nothing when no tool has started', () => {
    expect(moveTo(idle, { x: 1, y: 1 }, context).actions).toEqual([])
  })

  /*
   * The lazy step, and the reason escaping never has to delete anything: after a
   * click the chain waits, and the next segment is created by the move.
   */
  it('starts the next segment of a chain, joined to the last', () => {
    const step = moveTo(
      { kind: 'chaining', fromPointId: 7 },
      { x: 2, y: 2 },
      context
    )

    expect(step.actions).toEqual([
      {
        kind: 'chain',
        fromPointId: 7,
        segment: zeroLengthLine({ x: 2, y: 2 }, 'Mm'),
        label: LINE_SEGMENT_LABEL,
      },
    ])
  })
})

describe('the second click', () => {
  it('commits the draft and offers to chain from its end', () => {
    const step = place(drawing, { x: 10, y: 0 }, context)

    expect(step.actions).toEqual([
      { kind: 'move', pointId: 7, to: { x: 10, y: 0 }, commit: true },
    ])
    expect(step.state).toEqual({ kind: 'chaining', fromPointId: 7 })
  })

  it('has nothing to commit if the pointer has not moved since the last', () => {
    const chaining = { kind: 'chaining' as const, fromPointId: 7 }
    expect(place(chaining, { x: 1, y: 1 }, context)).toEqual({
      state: chaining,
      actions: [],
    })
  })
})

describe('abandoning', () => {
  it('throws away everything a draft created', () => {
    expect(abandon(drawing)).toEqual({
      state: idle,
      actions: [{ kind: 'discard', segmentIds: [5, 6, 7] }],
    })
  })

  it('has nothing to throw away while a chain is waiting', () => {
    // Everything in the file at that moment is committed geometry.
    expect(abandon({ kind: 'chaining', fromPointId: 7 })).toEqual({
      state: idle,
      actions: [],
    })
  })

  it('is a no-op from idle', () => {
    expect(abandon(idle)).toEqual({ state: idle, actions: [] })
  })
})

describe('what the drawing needs to know', () => {
  it('names the draft segments so they can be drawn as drafts', () => {
    expect(draftSegmentIds(drawing)).toEqual([5, 6, 7])
  })

  it('names none while chaining, because nothing is provisional then', () => {
    expect(draftSegmentIds({ kind: 'chaining', fromPointId: 7 })).toEqual([])
  })

  it('knows when Escape has something of its own to undo', () => {
    expect(isMidDraft(idle)).toBe(false)
    expect(isMidDraft(drawing)).toBe(true)
    expect(isMidDraft({ kind: 'chaining', fromPointId: 1 })).toBe(true)
  })
})

describe('how numbers are written', () => {
  it('rounds to two places, as the existing app does', () => {
    expect(roundOff(1 / 3)).toBe(0.33)
    expect(roundOff(10)).toBe(10)
  })

  /*
   * `Var`, not `Number`. A `Var` becomes a variable in the KCL, which is what
   * lets the solver move the point afterwards; a literal is a value the solver
   * may not touch, and the first constraint applied to it would conflict.
   */
  it('writes coordinates as solver variables', () => {
    expect(expr(1 / 3, 'Inch')).toEqual({
      type: 'Var',
      value: 0.33,
      units: 'Inch',
    })
  })
})

describe('dragging something already in the sketch', () => {
  const dragging = {
    kind: 'dragging' as const,
    objectId: 4,
    from: { x: 5, y: 5 },
  }

  it('previews the move as the pointer goes, like a rubber band', () => {
    expect(moveTo(dragging, { x: 7, y: 8 }, context).actions).toEqual([
      {
        kind: 'drag',
        objectId: 4,
        from: { x: 5, y: 5 },
        to: { x: 7, y: 8 },
        commit: false,
      },
    ])
  })

  it('commits where it was released, and stops', () => {
    const step = endDrag(dragging, { x: 9, y: 9 })

    expect(step.actions).toEqual([
      {
        kind: 'drag',
        objectId: 4,
        from: { x: 5, y: 5 },
        to: { x: 9, y: 9 },
        commit: true,
      },
    ])
    expect(step.state).toEqual({ kind: 'idle' })
  })

  /*
   * The measuring point moves only when a solve was accepted, which is what
   * stops a refused constraint from offsetting the pointer from the geometry for
   * the rest of the drag.
   */
  it('re-measures from where the last accepted solve left the pointer', () => {
    expect(advanceDrag(dragging, { x: 7, y: 8 })).toEqual({
      kind: 'dragging',
      objectId: 4,
      from: { x: 7, y: 8 },
    })
  })

  it('has nothing to advance when nothing is being dragged', () => {
    expect(advanceDrag(idle, { x: 7, y: 8 })).toEqual(idle)
  })

  it('ignores a click, because a drag ends on release', () => {
    expect(place(dragging, { x: 1, y: 1 }, context).actions).toEqual([])
  })

  /*
   * Nothing to throw away: the point was already in the sketch, and where it is
   * now is where the last preview left it.
   */
  it('has nothing to discard when abandoned', () => {
    expect(abandon(dragging)).toEqual({ state: { kind: 'idle' }, actions: [] })
  })

  it('names no draft segments, so nothing is drawn as provisional', () => {
    expect(draftSegmentIds(dragging)).toEqual([])
  })

  it('ends nothing when no drag is in progress', () => {
    expect(endDrag(idle, { x: 1, y: 1 }).actions).toEqual([])
  })
})

describe('the point tool', () => {
  const context = { tool: 'point' as const, units: 'Mm' as const }

  /*
   * Finished the moment it exists. There is nothing to drag open and nothing to
   * chain from, so the tool stays equipped and the next click is another point.
   */
  it('writes a finished point and holds nothing', () => {
    const step = place(idle, { x: 3, y: 4 }, context)

    expect(step.actions).toEqual([
      {
        kind: 'begin',
        segment: pointSegment({ x: 3, y: 4 }, 'Mm'),
        label: POINT_SEGMENT_LABEL,
        hold: { kind: 'none' },
      },
    ])
    expect(step.state).toEqual(idle)
  })
})

describe('the circle tool', () => {
  const context = { tool: 'circle' as const, units: 'Mm' as const }

  /*
   * A circle of no radius is degenerate — there is no rim point for the solver to
   * hold an opinion about — so the first click writes nothing.
   */
  it('remembers the centre rather than writing one', () => {
    const step = place(idle, { x: 1, y: 1 }, context)

    expect(step.actions).toEqual([])
    expect(step.state).toEqual({ kind: 'pending', points: [{ x: 1, y: 1 }] })
  })

  it('asks the frontend for nothing while the radius is being chosen', () => {
    const pending = { kind: 'pending' as const, points: [{ x: 1, y: 1 }] }

    // The preview is drawn from the collected clicks and the pointer, so there
    // is nothing to solve.
    expect(moveTo(pending, { x: 9, y: 9 }, context).actions).toEqual([])
  })

  it('writes the circle on the second click, from centre and rim', () => {
    const pending = { kind: 'pending' as const, points: [{ x: 0, y: 0 }] }

    const step = place(pending, { x: 5, y: 0 }, context)

    expect(step.actions).toEqual([
      {
        kind: 'begin',
        segment: circleFrom({ x: 0, y: 0 }, { x: 5, y: 0 }, 'Mm'),
        label: CIRCLE_SEGMENT_LABEL,
        hold: { kind: 'none' },
      },
    ])
    expect(step.state).toEqual(idle)
  })

  it('keeps the rim as a point rather than as a radius', () => {
    const circle = circleFrom({ x: 0, y: 0 }, { x: 5, y: 0 }, 'Mm')

    /*
     * Which is what the graph stores, and why the second click is a shape rather
     * than a number: the rim point stays in the sketch and can be dragged,
     * constrained and dimensioned afterwards.
     */
    expect(circle).toEqual({
      type: 'Circle',
      center: {
        x: { type: 'Var', value: 0, units: 'Mm' },
        y: { type: 'Var', value: 0, units: 'Mm' },
      },
      start: {
        x: { type: 'Var', value: 5, units: 'Mm' },
        y: { type: 'Var', value: 0, units: 'Mm' },
      },
    })
  })

  it('throws collected clicks away with nothing to delete', () => {
    const pending = { kind: 'pending' as const, points: [{ x: 1, y: 1 }] }

    // Nothing was written, so there is nothing to take away.
    expect(abandon(pending)).toEqual({ state: idle, actions: [] })
  })
})

describe('the three-point arc tool', () => {
  const context = { tool: 'threePointArc' as const, units: 'Mm' as const }
  const start = { x: 0, y: 0 }
  const end = { x: 10, y: 0 }

  it('collects the first click, because one point is not an arc', () => {
    expect(place(idle, start, context)).toEqual({
      state: { kind: 'pending', points: [start] },
      actions: [],
    })
  })

  /*
   * The same idea as the line's zero-length segment: from the second click on,
   * what is on screen is the solver's arc rather than a drawing of one.
   */
  it('writes a half circle on the chord at the second click', () => {
    const step = place({ kind: 'pending', points: [start] }, end, context)

    expect(step.actions).toEqual([
      {
        kind: 'begin',
        segment: {
          type: 'Arc',
          start: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          end: {
            x: { type: 'Var', value: 10, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          center: {
            x: { type: 'Var', value: 5, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
        },
        label: ARC_SEGMENT_LABEL,
        // The clicks travel with the hold: the third point is worked out
        // against them, and the frontend does not know about either.
        hold: { kind: 'shape', points: [start, end] },
      },
    ])
  })

  const shaping = {
    kind: 'shaping' as const,
    segmentId: 4,
    points: [start, end],
    segmentIds: [4],
  }

  it('bends the whole arc as the pointer moves, rather than moving a point', () => {
    const step = moveTo(shaping, { x: 5, y: 5 }, context)

    expect(step.actions).toEqual([
      {
        kind: 'reshape',
        edits: [
          {
            id: 4,
            ctor: {
              type: 'Arc',
              start: {
                x: { type: 'Var', value: 0, units: 'Mm' },
                y: { type: 'Var', value: 0, units: 'Mm' },
              },
              end: {
                x: { type: 'Var', value: 10, units: 'Mm' },
                y: { type: 'Var', value: 0, units: 'Mm' },
              },
              center: {
                x: { type: 'Var', value: 5, units: 'Mm' },
                y: { type: 'Var', value: 0, units: 'Mm' },
              },
              // Start is on the left, so a sweep that passes above the chord
              // runs clockwise.
              direction: 'cw',
            },
          },
        ],
        commit: false,
      },
    ])
  })

  it('sweeps the other way when the pointer is on the other side', () => {
    const step = moveTo(shaping, { x: 5, y: -5 }, context)
    const [action] = step.actions
    if (action?.kind !== 'reshape') throw new Error('expected a reshape')

    expect(action.edits[0]?.ctor).toMatchObject({ direction: 'ccw' })
  })

  it('keeps the last arc that made sense when the points fall in a line', () => {
    // Flattening the arc as the pointer crosses the chord would make it vanish
    // and come back, which reads as the tool failing.
    expect(moveTo(shaping, { x: 5, y: 0 }, context).actions).toEqual([])
  })

  it('commits on the third click and finishes', () => {
    const step = place(shaping, { x: 5, y: 5 }, context)
    const [action] = step.actions

    expect(action?.kind).toBe('reshape')
    expect(action).toMatchObject({ commit: true })
    expect(step.state).toEqual(idle)
  })

  it('throws the arc away when it is abandoned half-bent', () => {
    expect(abandon(shaping)).toEqual({
      state: idle,
      actions: [{ kind: 'discard', segmentIds: [4] }],
    })
  })

  it('draws the arc as a draft until it is committed', () => {
    expect(draftSegmentIds(shaping)).toEqual([4])
  })
})
