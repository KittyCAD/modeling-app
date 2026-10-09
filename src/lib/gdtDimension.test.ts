import { describe, expect, it, vi } from 'vitest'
import {
  classifyCylindricalFace,
  getDimensionFunction,
  isCircularArc,
} from '@src/lib/gdtDimension'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type { Selections } from '@src/machines/modelingSharedTypes'

const section = (z: number, sweep = 2 * Math.PI, rx = 5, ry = rx) =>
  Array.from({ length: 9 }, (_, i) => ({
    x: 100 + rx * Math.cos((i * sweep) / 8),
    y: -20 + ry * Math.sin((i * sweep) / 8),
    z,
  }))

describe('circular dimension classification', () => {
  it('rejects symmetric spherical sections whose tangent is not axial', () => {
    expect(
      classifyCylindricalFace(section(-5), section(5), { x: 5, y: 0, z: 5 })
    ).toBe('distance')
    expect(
      classifyCylindricalFace(section(-5), section(5), { x: 0, y: 0, z: 10 })
    ).toBe('diameter')
  })
  it('recognizes rational circular arc control polygons and rejects ellipses', () => {
    expect(
      isCircularArc([
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 5, z: 0 },
        { x: 0, y: 5, z: 0 },
      ])
    ).toBe(true)
    expect(
      isCircularArc([
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 8, z: 0 },
        { x: 0, y: 8, z: 0 },
      ])
    ).toBe(false)
  })
  it('uses diameter for a full cylinder and radius for a partial cylinder', () => {
    expect(classifyCylindricalFace(section(0), section(12))).toBe('diameter')
    expect(
      classifyCylindricalFace(section(0, Math.PI), section(12, Math.PI))
    ).toBe('radius')
  })
  it('recognizes rotated cylinders', () => {
    const rotate = (points: ReturnType<typeof section>) =>
      points.map(({ x, y, z }) => ({
        x: (x - z) / Math.SQRT2,
        y,
        z: (x + z) / Math.SQRT2,
      }))
    expect(
      classifyCylindricalFace(rotate(section(0)), rotate(section(12)))
    ).toBe('diameter')
  })
  it('keeps ellipses, cones, planes and invalid geometry as distance', () => {
    expect(
      classifyCylindricalFace(
        section(0, 2 * Math.PI, 5, 8),
        section(12, 2 * Math.PI, 5, 8)
      )
    ).toBe('distance')
    expect(
      classifyCylindricalFace(section(0), section(12, 2 * Math.PI, 8))
    ).toBe('distance')
    expect(classifyCylindricalFace(section(0), section(0))).toBe('distance')
    expect(classifyCylindricalFace([], [])).toBe('distance')
    const invalid = section(0)
    invalid[2].x = NaN
    expect(classifyCylindricalFace(invalid, section(12))).toBe('distance')
  })
})

const selections: Selections = {
  graphSelections: [
    { engineEntityId: 'edge', entityRef: { type: 'edge', side_faces: [] } },
  ],
  otherSelections: [],
}

function engineForCurve(
  type: 'arc' | 'line' | 'nurbs',
  closed: boolean,
  controlPoints: ReturnType<typeof section> = []
) {
  const sendSceneCommand = vi
    .fn<ConnectionManager['sendSceneCommand']>()
    .mockImplementation(async (command) => {
      if (command.type !== 'modeling_cmd_req')
        throw new Error('Unexpected command')
      const response =
        command.cmd.type === 'curve_get_type'
          ? { type: 'curve_get_type' as const, data: { curve_type: type } }
          : command.cmd.type === 'curve_get_end_points'
            ? {
                type: 'curve_get_end_points' as const,
                data: {
                  start: { x: 5, y: 0, z: 0 },
                  end: { x: closed ? 5 : -5, y: 0, z: 0 },
                },
              }
            : {
                type: 'curve_get_control_points' as const,
                data: { control_points: controlPoints },
              }
      return {
        success: true,
        resp: { type: 'modeling', data: { modeling_response: response } },
      }
    })
  return { sendSceneCommand }
}

describe('Dimension selection routing', () => {
  it('recognizes a full circle represented as a quadratic NURBS', async () => {
    const points = [
      [5, 0],
      [5, 5],
      [0, 5],
      [-5, 5],
      [-5, 0],
      [-5, -5],
      [0, -5],
      [5, -5],
      [5, 0],
    ].map(([x, y]) => ({ x, y, z: 0 }))
    expect(
      await getDimensionFunction(
        selections,
        engineForCurve('nurbs', true, points)
      )
    ).toBe('diameter')
  })
  it.each([
    ['arc', true, 'diameter'],
    ['arc', false, 'radius'],
    ['line', false, 'distance'],
    ['nurbs', true, 'distance'],
  ] as const)(
    'routes a %s curve (closed=%s) to %s',
    async (type, closed, expected) => {
      expect(
        await getDimensionFunction(selections, engineForCurve(type, closed))
      ).toBe(expected)
    }
  )
  it('does not query geometry for two selected circles or an empty selection', async () => {
    const engine = engineForCurve('arc', true)
    expect(
      await getDimensionFunction(
        {
          ...selections,
          graphSelections: [
            ...selections.graphSelections,
            ...selections.graphSelections,
          ],
        },
        engine
      )
    ).toBe('distance')
    expect(
      await getDimensionFunction(
        { graphSelections: [], otherSelections: [] },
        engine
      )
    ).toBe('distance')
    expect(engine.sendSceneCommand).not.toHaveBeenCalled()
  })
  it('preserves distance when a geometry query fails', async () => {
    const engine = engineForCurve('arc', true)
    engine.sendSceneCommand.mockRejectedValue(new Error('Offline'))
    expect(await getDimensionFunction(selections, engine)).toBe('distance')
  })
  it.each([
    ['diameter', false],
    ['radius', true],
  ] as const)(
    'classifies an imported face as %s with swapped parameters=%s',
    async (expected, swap) => {
      const sendSceneCommand = vi
        .fn<ConnectionManager['sendSceneCommand']>()
        .mockImplementation(async (command) => {
          if (command.type !== 'modeling_cmd_req')
            throw new Error('Unexpected command')
          const cmd = command.cmd
          if (cmd.type !== 'face_get_position') {
            const responses = {
              face_get_gradient: {
                df_du: swap ? { x: 0, y: 0, z: 10 } : { x: 1, y: 0, z: 0 },
                df_dv: swap ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 10 },
                normal: { x: 0, y: 1, z: 0 },
              },
              entity_get_parent_id: { entity_id: 'imported-body' },
              entity_get_all_child_uuids: { entity_ids: ['rim'] },
              get_entity_type: { entity_type: 'edge' },
              solid3d_get_all_edge_faces: { faces: ['imported-face'] },
              curve_get_type: { curve_type: 'arc' },
              curve_get_end_points: {
                start: { x: 5, y: 0, z: 0 },
                end: { x: expected === 'diameter' ? 5 : -5, y: 0, z: 0 },
              },
              curve_get_control_points: {
                control_points: [
                  { x: 5, y: 0, z: 0 },
                  { x: 5, y: 5, z: 0 },
                  { x: 0, y: 5, z: 0 },
                  { x: -5, y: 5, z: 0 },
                  { x: -5, y: 0, z: 0 },
                ],
              },
            }
            return {
              success: true,
              resp: {
                type: 'modeling',
                data: {
                  modeling_response: {
                    type: cmd.type,
                    data: responses[cmd.type as keyof typeof responses],
                  },
                },
              },
            } as Awaited<ReturnType<ConnectionManager['sendSceneCommand']>>
          }
          expect(cmd.object_id).toBe('imported-face')
          const { x, y } = cmd.uv
          const u = swap ? y : x,
            v = swap ? x : y
          // Native cylinder UVs use radians, so 0..1 never samples its seam.
          const angle = u
          return {
            success: true,
            resp: {
              type: 'modeling',
              data: {
                modeling_response: {
                  type: 'face_get_position',
                  data: {
                    pos: {
                      x: 5 * Math.cos(angle),
                      y: 5 * Math.sin(angle),
                      z: v * 10,
                    },
                  },
                },
              },
            },
          }
        })
      const imported: Selections = {
        graphSelections: [],
        otherSelections: [
          {
            type: 'enginePrimitive',
            primitiveType: 'face',
            entityId: 'imported-face',
            parentEntityId: 'imported-body',
            primitiveIndex: 0,
          },
        ],
      }
      expect(await getDimensionFunction(imported, { sendSceneCommand })).toBe(
        expected
      )
    }
  )
})
