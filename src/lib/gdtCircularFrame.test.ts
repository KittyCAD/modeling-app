import type { Point3d } from '@kittycad/lib'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  getCircularFrameGeometry,
  getCircularFrameGeometryForEntity,
  getCircularFramePosition,
} from '@src/lib/gdtCircularFrame'
import { describe, expect, it, vi } from 'vitest'

function circle(
  plane: 'XY' | 'XZ' | 'YZ',
  sign: number,
  arc = false
): Point3d[] {
  const controls = [
    [5, 0],
    [5, 5],
    [0, 5],
    [-5, 5],
    [-5, 0],
    [-5, -5],
    [0, -5],
    [5, -5],
    [5, 0],
  ]
  return (arc ? controls.slice(0, 5) : controls).map(([x, y]) =>
    plane === 'XY'
      ? { x: x * sign + 70, y: y + 20, z: 40 }
      : plane === 'XZ'
        ? { x: x * sign + 70, y: 20, z: y + 40 }
        : { x: 70, y: x * sign + 20, z: y + 40 }
  )
}

describe('circular dimension frame defaults', () => {
  it.each(['XY', 'XZ', 'YZ'] as const)(
    'uses the %s circular plane, not a plane through its axis',
    (plane) => {
      expect(getCircularFrameGeometry(circle(plane, 1))?.framePlane).toBe(plane)
    }
  )
  it.each([-1, 1])(
    'keeps the frame on the normalized leader side for sign %s',
    (sign) => {
      for (const plane of ['XY', 'XZ', 'YZ'] as const) {
        const geometry = getCircularFrameGeometry(circle(plane, sign))!
        const position = getCircularFramePosition(geometry, plane, 1)!
        expect(Math.sign(position[0])).toBe(-sign)
        expect(position[0]).toBeCloseTo(-sign * 6)
        expect(position[1]).toBeCloseTo(3.75)
      }
    }
  )
  it('places a radius label outside its arc at the leader midpoint', () => {
    const geometry = getCircularFrameGeometry(circle('XZ', 1, true))!
    expect(geometry.radial).toEqual({ x: 0, y: 0, z: 5 })
    expect(getCircularFramePosition(geometry, 'XZ', 1)).toEqual([6, 3.75])
  })
  it('handles a tangent midpoint of a single quadratic arc', () => {
    const geometry = getCircularFrameGeometry(circle('XY', 1).slice(0, 3))!
    expect(Math.hypot(geometry.radial.x, geometry.radial.y)).toBeCloseTo(5)
    expect(geometry.radial.x).toBeCloseTo(5 / Math.sqrt(2))
  })
  it('projects the leader into an explicit plane and converts mm to file units', () => {
    const geometry = getCircularFrameGeometry(circle('XZ', 1))!
    expect(getCircularFramePosition(geometry, 'XY', 10)).toEqual([-0.6, 0.375])
    expect(getCircularFramePosition(geometry, 'XZ', 1, 10)).toEqual([-20, 20])
    expect(getCircularFramePosition(geometry, 'customPlane', 1)).toBeUndefined()
  })
  it('does not guess from missing or degenerate controls', () => {
    expect(getCircularFrameGeometry([])).toBeUndefined()
    expect(
      getCircularFrameGeometry([
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ])
    ).toBeUndefined()
    expect(
      getCircularFrameGeometry(
        circle('XY', 1).map((p) => ({ ...p, y: p.y * 2 }))
      )
    ).toBeUndefined()
  })
  it('finds the referenced cylinder rim rather than an unrelated circle on its body', async () => {
    const sendSceneCommand = vi
      .fn<ConnectionManager['sendSceneCommand']>()
      .mockImplementation(async (command) => {
        if (command.type !== 'modeling_cmd_req')
          throw new Error('Unexpected command')
        const cmd = command.cmd
        const data =
          cmd.type === 'entity_get_parent_id'
            ? { entity_id: 'body' }
            : cmd.type === 'entity_get_all_child_uuids'
              ? { entity_ids: ['unrelated', 'rim', 'face'] }
              : cmd.type === 'get_entity_type'
                ? { entity_type: cmd.entity_id === 'face' ? 'face' : 'edge' }
                : cmd.type === 'solid3d_get_all_edge_faces'
                  ? { faces: cmd.edge_id === 'rim' ? ['cylinder'] : ['other'] }
                  : cmd.type === 'curve_get_type'
                    ? { curve_type: 'arc' }
                    : { control_points: circle('YZ', 1) }
        return {
          success: true,
          resp: {
            type: 'modeling',
            data: { modeling_response: { type: cmd.type, data } },
          },
        } as Awaited<ReturnType<ConnectionManager['sendSceneCommand']>>
      })
    expect(
      (
        await getCircularFrameGeometryForEntity(
          { sendSceneCommand },
          'cylinder',
          false
        )
      )?.framePlane
    ).toBe('YZ')
    expect(
      sendSceneCommand.mock.calls.filter(
        ([command]) =>
          command.type === 'modeling_cmd_req' &&
          command.cmd.type === 'curve_get_control_points'
      )
    ).toHaveLength(1)
  })
})
