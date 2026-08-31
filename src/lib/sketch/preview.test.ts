import { describe, expect, it } from 'vitest'
import { PREVIEW_ID, previewShapes } from '@src/lib/sketch/preview'

const pending = { kind: 'pending' as const, points: [{ x: 0, y: 0 }] }

describe('the shape being started', () => {
  it('draws a circle from the centre click to the pointer', () => {
    expect(previewShapes(pending, 'circle', { x: 3, y: 4 })).toEqual([
      {
        id: PREVIEW_ID,
        construction: false,
        freedom: null,
        kind: 'circle',
        center: { x: 0, y: 0 },
        radius: 5,
      },
    ])
  })

  /*
   * Negative, so it cannot collide with a real one: the graph is a flat array and
   * an object's id *is* its index. Anything that looks it up finds nothing, which
   * is what makes a preview unpickable and undraggable for free.
   */
  it('carries an id nothing in the graph can have', () => {
    expect(PREVIEW_ID).toBeLessThan(0)
  })

  it('draws nothing before the pointer is over the plane', () => {
    expect(previewShapes(pending, 'circle', null)).toEqual([])
  })

  it('draws nothing for a radius of zero', () => {
    expect(previewShapes(pending, 'circle', { x: 0, y: 0 })).toEqual([])
  })

  /*
   * Every other state has real geometry to show: a line being dragged open is a
   * segment in the sketch and is drawn from the graph like anything else.
   */
  it('draws nothing for the states that have real geometry', () => {
    expect(previewShapes({ kind: 'idle' }, 'circle', { x: 1, y: 1 })).toEqual(
      []
    )
    expect(
      previewShapes({ kind: 'drawing', pointId: 1, segmentIds: [1] }, 'line', {
        x: 1,
        y: 1,
      })
    ).toEqual([])
  })

  /*
   * Two points do not pick an arc — every arc through them is equally valid
   * until the third click says which — so the chord is what is actually known.
   */
  it('draws the chord for an arc, not a guess at the arc', () => {
    expect(previewShapes(pending, 'threePointArc', { x: 3, y: 4 })).toEqual([
      {
        id: PREVIEW_ID,
        construction: false,
        freedom: null,
        kind: 'line',
        from: { x: 0, y: 0 },
        to: { x: 3, y: 4 },
      },
    ])
  })

  it('draws nothing for a tool that collects no clicks', () => {
    expect(previewShapes(pending, 'line', { x: 1, y: 1 })).toEqual([])
    expect(previewShapes(pending, null, { x: 1, y: 1 })).toEqual([])
  })
})
