import type { WebSocketResponse } from '@kittycad/lib'
import {
  chooseVertexEndpoint,
  resolveVertexPosition,
  validatePlanePoints,
} from '@src/lib/vertexPicking'
import type { PickedPoint } from '@src/lib/vertexPicking'
import { describe, expect, it, vi } from 'vitest'

const a: PickedPoint = [25.4, -10, 20]
const b: PickedPoint = [35.4, -10, 20]
const c: PickedPoint = [25.4, 0, 20]
const response = (type: string, data: unknown) =>
  ({
    success: true,
    resp: { type: 'modeling', data: { modeling_response: { type, data } } },
  }) as WebSocketResponse

describe('BRep vertex picking', () => {
  it('intersects incident edge endpoints without assuming endpoint order', async () => {
    const sendSceneCommand = vi
      .fn()
      .mockResolvedValueOnce(
        response('solid3d_get_common_edge', { edge: 'ab' })
      )
      .mockResolvedValueOnce(
        response('solid3d_get_common_edge', { edge: 'ac' })
      )
      .mockResolvedValueOnce(
        response('solid3d_get_common_edge', { edge: 'ad' })
      )
      .mockResolvedValueOnce(
        response('curve_get_end_points', {
          start: { x: b[0], y: b[1], z: b[2] },
          end: { x: a[0], y: a[1], z: a[2] },
        })
      )
      .mockResolvedValueOnce(
        response('curve_get_end_points', {
          start: { x: a[0], y: a[1], z: a[2] },
          end: { x: c[0], y: c[1], z: c[2] },
        })
      )
      .mockResolvedValueOnce(
        response('curve_get_end_points', {
          start: { x: a[0], y: a[1], z: 30 },
          end: { x: a[0], y: a[1], z: a[2] },
        })
      )
    expect(
      await resolveVertexPosition({
        reference: {
          type: 'vertex',
          side_faces: ['f1', 'f2', 'f3'],
          index: 12,
        },
        parentId: 'part',
        engine: { sendSceneCommand },
      })
    ).toEqual(a)
    expect(sendSceneCommand.mock.calls[0][0].cmd).toEqual({
      type: 'solid3d_get_common_edge',
      object_id: 'part',
      face_ids: ['f1', 'f2'],
    })
  })

  it('uses the click to disambiguate two vertices on the same pair of faces', () => {
    const project = (p: PickedPoint) => ({ x: p[0], y: p[1] })
    expect(
      chooseVertexEndpoint([[a, b]], { x: b[0] + 1, y: b[1] }, project)
    ).toEqual(b)
    expect(chooseVertexEndpoint([[a, b]])).toBeInstanceOf(Error)
    expect(
      chooseVertexEndpoint([[a, b]], { x: 30.4, y: -10 }, project)
    ).toBeInstanceOf(Error)
    expect(
      chooseVertexEndpoint([[a, b]], { x: 100, y: 100 }, project)
    ).toBeInstanceOf(Error)
  })

  it('rejects missing topology, failed queries, and inconsistent edge coordinates', async () => {
    const sendSceneCommand = vi.fn().mockResolvedValue(null)
    expect(
      await resolveVertexPosition({
        reference: { type: 'vertex', side_faces: ['f1', 'f2'] },
        parentId: 'part',
        engine: { sendSceneCommand },
      })
    ).toBeInstanceOf(Error)
    expect(chooseVertexEndpoint([])).toBeInstanceOf(Error)
    expect(
      chooseVertexEndpoint([
        [a, b],
        [c, [0, 0, 0]],
      ])
    ).toBeInstanceOf(Error)
    expect(
      chooseVertexEndpoint([
        [
          [NaN, 0, 0],
          [Infinity, 0, 0],
        ],
      ])
    ).toBeInstanceOf(Error)
  })
})

describe('picked plane validation', () => {
  it('requires exactly three finite, distinct, non-collinear points', () => {
    expect(validatePlanePoints([a, b, c])).toBe(true)
    for (const points of [
      [],
      [a, b],
      [a, b, c, [0, 0, 0]],
      [a, a, c],
      [
        [0, 0, 0],
        [1, 1, 1],
        [2, 2, 2],
      ],
      [a, b, [NaN, 0, 0]],
    ] as PickedPoint[][]) {
      expect(validatePlanePoints(points)).toBeInstanceOf(Error)
    }
  })
})
