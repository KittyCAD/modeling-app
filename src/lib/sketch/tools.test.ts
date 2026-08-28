import { describe, expect, it } from 'vitest'
import {
  cancelTool,
  equipTool,
  placePoint,
  previewOf,
} from '@src/lib/sketch/tools'

describe('the line tool', () => {
  it('collects the first point without asking for anything', () => {
    const step = placePoint(equipTool('line'), { x: 1, y: 2 })

    expect(step.actions).toEqual([])
    expect(step.state.points).toEqual([{ x: 1, y: 2 }])
  })

  it('draws a line on the second point, and starts over', () => {
    const first = placePoint(equipTool('line'), { x: 0, y: 0 })
    const second = placePoint(first.state, { x: 10, y: 5 })

    expect(second.actions).toEqual([
      {
        kind: 'segment',
        segment: {
          type: 'Line',
          start: {
            x: { type: 'Number', value: 0, units: 'Mm' },
            y: { type: 'Number', value: 0, units: 'Mm' },
          },
          end: {
            x: { type: 'Number', value: 10, units: 'Mm' },
            y: { type: 'Number', value: 5, units: 'Mm' },
          },
        },
      },
    ])
    expect(second.state.points).toEqual([])
  })

  it('rounds to a micron, so a segment is not written with seventeen digits', () => {
    const first = placePoint(equipTool('line'), { x: 0, y: 0 })
    const second = placePoint(first.state, { x: 1 / 3, y: 0 })

    const [action] = second.actions
    expect(
      action?.segment.type === 'Line' &&
        action.segment.end.x.type === 'Number' &&
        action.segment.end.x.value
    ).toBe(0.333)
  })

  it('forgets a half-drawn line when it is cancelled', () => {
    const started = placePoint(equipTool('line'), { x: 0, y: 0 })

    expect(cancelTool(started.state).points).toEqual([])
    // The tool stays equipped: cancelling a line means "not that line", not
    // "not drawing any more".
    expect(cancelTool(started.state).tool).toBe('line')
  })
})

describe('previewOf', () => {
  it('rubber-bands from the first point to the pointer', () => {
    const started = placePoint(equipTool('line'), { x: 0, y: 0 })

    expect(previewOf(started.state, { x: 4, y: 4 })).toMatchObject({
      kind: 'line',
      from: { x: 0, y: 0 },
      to: { x: 4, y: 4 },
    })
  })

  it('has nothing to show before the first point', () => {
    expect(previewOf(equipTool('line'), { x: 4, y: 4 })).toBeNull()
  })

  it('has nothing to show when the pointer is off the plane', () => {
    const started = placePoint(equipTool('line'), { x: 0, y: 0 })
    expect(previewOf(started.state, null)).toBeNull()
  })
})
