import { describe, expect, it } from 'vitest'
import {
  LINE_SEGMENT_LABEL,
  abandon,
  draftSegmentIds,
  expr,
  isMidDraft,
  moveTo,
  place,
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
