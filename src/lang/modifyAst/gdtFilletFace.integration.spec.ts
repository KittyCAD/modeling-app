import { describe, expect, it, vi } from 'vitest'
import { assertParse, recast } from '@src/lang/wasm'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import { getDimensionDetails } from '@src/lib/gdtDimension'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

describe('dimensions on fillet faces', () => {
  it.each([
    'cylindrical',
    'toroidal',
    'toroidal-end-arcs',
    'toroidal-native-uv',
  ])(
    'creates a radius on the selected %s face rather than a boundary diameter',
    async (kind) => {
      const toroidal = kind !== 'cylindrical'
      const nativeUv = kind === 'toroidal-native-uv'
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndNoEngineConnection()
      const ast = assertParse(
        `@settings(kclVersion = 3.0)
profile = sketch(on = XY) {
${
  toroidal
    ? 'rim = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])'
    : `line1 = line(start = [var 0mm, var 0mm], end = [var 20mm, var 0mm])
line2 = line(start = [var 20mm, var 0mm], end = [var 20mm, var 20mm])
line3 = line(start = [var 20mm, var 20mm], end = [var 0mm, var 20mm])
line4 = line(start = [var 0mm, var 20mm], end = [var 0mm, var 0mm])`
}
}
solid = extrude(region(segments = [${toroidal ? 'profile.rim' : 'profile.line1, profile.line2, profile.line3, profile.line4'}]), length = 10mm, tagEnd = $top)
roundedSolid = fillet(solid, edges = [{sideFaces = [${toroidal ? 'solid.sketch.tags.rim, solid.faces.top' : 'solid.sketch.tags.line1, solid.sketch.tags.line2'}]}], radius = 2mm, tag = $rounded)`,
        instance
      )
      const { artifactGraph } = await enginelessExecutor(ast, rustContext)
      const cut = [...artifactGraph.values()].find((a) => a.type === 'edgeCut')
      const sweep = [...artifactGraph.values()].find((a) => a.type === 'sweep')
      if (cut?.type !== 'edgeCut' || sweep?.type !== 'sweep')
        throw new Error('Missing fillet face')
      kclManager.artifactGraph = artifactGraph
      const objects = {
        graphSelections: [
          {
            artifact: cut,
            engineEntityId: cut.id,
            entityRef: { type: 'face' as const, face_id: cut.id },
          },
        ],
        otherSelections: [],
      }
      let inconsistentProfiles = false
      const endArcs = kind === 'toroidal-end-arcs'
      const controls = (edge: string) => {
        if (edge.startsWith('seam'))
          return [
            { x: 10, y: 0, z: 8 },
            { x: 10, y: 0, z: 10 },
            { x: 8, y: 0, z: 10 },
          ].map((p) =>
            inconsistentProfiles && edge === 'seamB'
              ? { x: 8 + (p.x - 8) * 1.5, y: p.y, z: 8 + (p.z - 8) * 1.5 }
              : p
          )
        const radius = toroidal ? (edge === 'outer' ? 10 : 8) : 2
        const z = toroidal ? (edge === 'outer' ? 8 : 10) : 0
        return (
          toroidal
            ? [
                [1, 0],
                [1, 1],
                [0, 1],
                [-1, 1],
                [-1, 0],
                [-1, -1],
                [0, -1],
                [1, -1],
                [1, 0],
              ]
            : [
                [1, 0],
                [1, 1],
                [0, 1],
              ]
        ).map(([x, y]) => ({
          x: x * radius * (nativeUv ? 1.05 : 1),
          y: y * radius,
          z,
        }))
      }
      const mock = vi
        .spyOn(engineCommandManager, 'sendSceneCommand')
        .mockImplementation(async (command) => {
          if (command.type !== 'modeling_cmd_req')
            throw new Error('Unexpected command')
          const cmd = command.cmd
          let data: unknown
          if (
            cmd.type === 'face_get_position' ||
            cmd.type === 'face_get_gradient'
          ) {
            if (nativeUv)
              throw new Error(
                'Native UVs outside the trimmed fillet domain must not be sampled'
              )
            const u = cmd.uv.x * Math.PI * 2
            const v = (cmd.uv.y * Math.PI) / 2
            const radius = 2
            if (cmd.type === 'face_get_position')
              data = {
                pos: toroidal
                  ? {
                      x: (8 + radius * Math.cos(v)) * Math.cos(u),
                      y: (8 + radius * Math.cos(v)) * Math.sin(u),
                      z: 8 + radius * Math.sin(v),
                    }
                  : {
                      x: radius * Math.cos(u / 4),
                      y: radius * Math.sin(u / 4),
                      z: v * 10,
                    },
              }
            else {
              const alongU = toroidal
                ? {
                    x: -(8 + radius * Math.cos(v)) * Math.sin(u),
                    y: (8 + radius * Math.cos(v)) * Math.cos(u),
                    z: 0,
                  }
                : { x: -Math.sin(u / 4), y: Math.cos(u / 4), z: 0 }
              const alongV = toroidal
                ? {
                    x: -radius * Math.sin(v) * Math.cos(u),
                    y: -radius * Math.sin(v) * Math.sin(u),
                    z: radius * Math.cos(v),
                  }
                : { x: 0, y: 0, z: 10 }
              data = {
                df_du: alongU,
                df_dv: alongV,
              }
            }
          } else if (cmd.type === 'curve_get_control_points')
            data = { control_points: controls(cmd.curve_id) }
          else if (cmd.type === 'curve_get_end_points') {
            const points = controls(cmd.curve_id)
            data = { start: points[0], end: points[points.length - 1] }
          } else {
            const responses = {
              entity_get_parent_id: { entity_id: sweep.id },
              entity_get_all_child_uuids: {
                entity_ids: toroidal
                  ? [
                      'outer',
                      'top',
                      ...(endArcs ? ['seamA', 'seamB'] : ['seam']),
                    ]
                  : ['outer'],
              },
              get_entity_type: { entity_type: 'edge' },
              solid3d_get_all_edge_faces: {
                faces:
                  cmd.type === 'solid3d_get_all_edge_faces' &&
                  cmd.edge_id.startsWith('seam') &&
                  !endArcs
                    ? [cut.id]
                    : [cut.id, 'cap'],
              },
              curve_get_type: {
                curve_type:
                  nativeUv &&
                  cmd.type === 'curve_get_type' &&
                  !cmd.curve_id.startsWith('seam')
                    ? 'nurbs'
                    : 'arc',
              },
              face_get_center: { pos: { x: 0, y: 0, z: 9 } },
            }
            data = responses[cmd.type as keyof typeof responses]
          }
          return {
            success: true,
            resp: {
              type: 'modeling',
              data: { modeling_response: { type: cmd.type, data } },
            },
          } as Awaited<ReturnType<typeof engineCommandManager.sendSceneCommand>>
        })
      try {
        const result = await modelingCommandCodemods['GDT Distance'].run({
          ast,
          args: { objects },
          kclManager,
          wasmInstance: instance,
        })
        if (result instanceof Error) throw result
        const code = recast(result.modifiedAst, instance)
        if (code instanceof Error) throw code
        expect(code.replace(/\s+/g, '')).toContain(
          'gdt::radius(target=rounded,'
        )
        expect(code).not.toContain('gdt::diameter(')
        expect(code).not.toContain('gdt::distance(')
        expect(code).toContain(`framePlane = ${toroidal ? 'XZ' : 'XY'}`)
        if (toroidal) expect(code).toMatch(/framePosition = \[-/)
        await enginelessExecutor(result.modifiedAst, rustContext)
        if (nativeUv) {
          expect(
            mock.mock.calls.some(
              ([command]) =>
                command.type === 'modeling_cmd_req' &&
                command.cmd.type === 'face_get_position'
            )
          ).toBe(false)
          return
        }
        if (toroidal) {
          // Unrecognized toroidal faces retain the distance behavior.
          expect(
            (
              await getDimensionDetails(
                {
                  ...objects,
                  graphSelections: [
                    {
                      entityRef: objects.graphSelections[0].entityRef,
                      engineEntityId: cut.id,
                    },
                  ],
                },
                engineCommandManager,
                new Map()
              )
            ).dimensionFunction
          ).toBe('distance')
          if (!endArcs) return
          inconsistentProfiles = true
          expect(
            (
              await getDimensionDetails(
                objects,
                engineCommandManager,
                artifactGraph
              )
            ).dimensionFunction
          ).toBe('distance')
        }
      } finally {
        mock.mockRestore()
      }
    }
  )
})
