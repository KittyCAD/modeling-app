import type {
  ApiObject,
  ArcDirection,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { describe, expect, it } from 'vitest'

import { getArcPoints } from '@src/machines/sketchSolve/constraints/constraintUtils'

function makePointObject(id: number, x: number, y: number): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Point',
        position: {
          x: { value: x, units: 'Mm' },
          y: { value: y, units: 'Mm' },
        },
        ctor: null,
        owner: null,
        freedom: 'Fixed',
        constraints: [],
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function makeArcObject(
  id: number,
  startId: number,
  endId: number,
  centerId: number,
  direction?: ArcDirection
): ApiObject {
  const zero = {
    x: { type: 'Var', value: 0, units: 'Mm' } as const,
    y: { type: 'Var', value: 0, units: 'Mm' } as const,
  }
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Arc',
        start: startId,
        end: endId,
        center: centerId,
        ctor: {
          type: 'Arc',
          start: zero,
          end: zero,
          center: zero,
        },
        ctor_applicable: false,
        construction: false,
        direction,
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

describe('getArcPoints', () => {
  const start = makePointObject(0, 5, 0)
  const end = makePointObject(1, -5, 0)
  const center = makePointObject(2, 0, 0)

  it('returns declared start and end for a counterclockwise arc', () => {
    const arc = makeArcObject(3, start.id, end.id, center.id)
    const objects = [start, end, center, arc]

    expect(getArcPoints(arc, objects)).toEqual({
      center: [0, 0],
      start: [5, 0],
      end: [-5, 0],
      isCircle: false,
    })
  })

  it('returns start and end in counterclockwise sweep order for a clockwise arc', () => {
    const arc = makeArcObject(3, start.id, end.id, center.id, 'cw')
    const objects = [start, end, center, arc]

    expect(getArcPoints(arc, objects)).toEqual({
      center: [0, 0],
      start: [-5, 0],
      end: [5, 0],
      isCircle: false,
    })
  })
})
