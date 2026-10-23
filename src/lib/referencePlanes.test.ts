import type { WebSocketResponse } from '@kittycad/lib'
import {
  constructReferencePlane,
  inferReferencePlane,
  resolveReferencePlane,
} from '@src/lib/referencePlanes'
import type { PlaneFrame } from '@src/lib/referencePlanes'
import type { PickedPoint } from '@src/lib/vertexPicking'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { describe, expect, it, vi } from 'vitest'

const xy: PlaneFrame = {
  origin: [10, 20, 0],
  normal: [0, 0, 1],
  xAxis: [1, 0, 0],
}
const selections = (
  points: PickedPoint[] = [],
  faces: string[] = []
): Selections => ({
  otherSelections: [],
  graphSelections: [
    ...points.map((vertexPosition, index) => ({
      entityRef: { type: 'vertex' as const, side_faces: [], index },
      vertexPosition,
    })),
    ...faces.map((face_id) => ({
      entityRef: { type: 'face' as const, face_id },
    })),
  ],
})

describe('reference planes', () => {
  it('infers definitions independently of selection order and rejects unsupported combinations', () => {
    expect(inferReferencePlane(selections([], ['a']))).toBe('Offset')
    expect(inferReferencePlane(selections([], ['a', 'b']))).toBe('Midplane')
    const mixed = selections([[1, 2, 3]], ['a'])
    expect(inferReferencePlane(mixed)).toBe('Parallel through point')
    mixed.graphSelections.reverse()
    expect(inferReferencePlane(mixed)).toBe('Parallel through point')
    expect(
      inferReferencePlane(
        selections([
          [0, 0, 0],
          [0, 0, 10],
        ])
      )
    ).toBe('Perpendicular bisector')
    expect(
      inferReferencePlane(
        selections([
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ])
      )
    ).toBe('Three points')
    expect(inferReferencePlane(selections())).toBeInstanceOf(Error)
    expect(
      inferReferencePlane(selections([[0, 0, 0]], ['a', 'b']))
    ).toBeInstanceOf(Error)
  })

  it('bisects parallel planes even when their normals oppose and origins differ tangentially', () => {
    const mid = constructReferencePlane(
      'Midplane',
      [],
      [xy, { ...xy, origin: [100, -200, 40], normal: [0, 0, -3] }]
    )
    expect(mid).toMatchObject({ origin: [10, 20, 20], normal: [0, 0, 1] })
    expect(
      constructReferencePlane(
        'Midplane',
        [],
        [xy, { ...xy, normal: [1, 0, 0], xAxis: [0, 1, 0] }]
      )
    ).toBeInstanceOf(Error)
  })

  it('constructs perpendicular bisectors and parallel planes without moving their defining points', () => {
    expect(
      constructReferencePlane(
        'Perpendicular bisector',
        [
          [0, 0, 0],
          [0, 0, 40],
        ],
        []
      )
    ).toMatchObject({ origin: [0, 0, 20], normal: [0, 0, 1] })
    expect(
      constructReferencePlane('Parallel through point', [[25.4, -10, 30]], [xy])
    ).toEqual({ ...xy, origin: [25.4, -10, 30] })
    expect(
      constructReferencePlane(
        'Perpendicular bisector',
        [
          [0, 0, 0],
          [0, 0, 0],
        ],
        []
      )
    ).toBeInstanceOf(Error)
    expect(
      constructReferencePlane(
        'Three points',
        [
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 0],
        ],
        []
      )
    ).toBeInstanceOf(Error)
  })

  it('reads planar faces without entering sketch mode, and rejects curved faces', async () => {
    const sendSceneCommand = vi.fn<() => Promise<WebSocketResponse>>(
      async () => ({
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'face_is_planar',
              data: {
                origin: { x: 0, y: 0, z: 20 },
                x_axis: { x: 1, y: 0, z: 0 },
                z_axis: { x: 0, y: 0, z: 1 },
              },
            },
          },
        },
      })
    )
    expect(
      await resolveReferencePlane(
        selections([[0, 0, 40]], ['face']),
        {},
        { sendSceneCommand },
        1
      )
    ).toMatchObject({ origin: [0, 0, 40] })
    expect(sendSceneCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: { type: 'face_is_planar', object_id: 'face' },
      })
    )
    sendSceneCommand.mockResolvedValue({
      success: true,
      resp: {
        type: 'modeling',
        data: { modeling_response: { type: 'face_is_planar', data: {} } },
      },
    })
    expect(
      await resolveReferencePlane(
        selections([], ['curve']),
        {},
        { sendSceneCommand },
        1
      )
    ).toBeInstanceOf(Error)
  })
})
