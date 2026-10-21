import { describe, expect, it, vi } from 'vitest'
import { assertParse, recast } from '@src/lang/wasm'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

describe('dimensions on fillet boundaries', () => {
  it.each(['radius', 'diameter'] as const)(
    'creates a %s from a fillet edge and keeps the filleted face reference',
    async (kind) => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndNoEngineConnection()
      const ast = assertParse(
        `@settings(kclVersion = 2.0)
profile = sketch(on = XY) {
${
  kind === 'diameter'
    ? 'rim = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])'
    : `line1 = line(start = [var 0mm, var 0mm], end = [var 20mm, var 0mm])
line2 = line(start = [var 20mm, var 0mm], end = [var 20mm, var 20mm])
line3 = line(start = [var 20mm, var 20mm], end = [var 0mm, var 20mm])
line4 = line(start = [var 0mm, var 20mm], end = [var 0mm, var 0mm])`
}
}
profileRegion = region(segments = [${kind === 'diameter' ? 'profile.rim' : 'profile.line1, profile.line2, profile.line3, profile.line4'}])
solid = extrude(profileRegion, length = 10mm, tagEnd = $top)
roundedSolid = fillet(solid, edges = [{ sideFaces = [${kind === 'diameter' ? 'profileRegion.tags.rim, top' : 'profileRegion.tags.line1, profileRegion.tags.line2'}] }], radius = 2mm, tag = $rounded)`,
        instance
      )
      const { artifactGraph } = await enginelessExecutor(ast, rustContext)
      const cut = [...artifactGraph.values()].find((a) => a.type === 'edgeCut')
      const sweep = [...artifactGraph.values()].find((a) => a.type === 'sweep')
      if (cut?.type !== 'edgeCut' || sweep?.type !== 'sweep' || !sweep.pathId)
        throw new Error('Missing filleted geometry')
      // Engine-free execution creates the fillet operation but cannot return
      // its boundary topology. Supply the clicked boundary and adjacent cap.
      const cap = {
        type: 'cap' as const,
        id: 'top-cap',
        subType: 'end' as const,
        sweepId: sweep.id,
        pathIds: [sweep.pathId],
        edgeCutEdgeIds: [],
        faceCodeRef: sweep.codeRef,
        cmdId: sweep.id,
      }
      artifactGraph.set(cap.id, cap)
      const boundary = {
        type: 'edgeCutEdge' as const,
        id: 'fillet-boundary',
        edgeCutId: cut.id,
        surfaceId: cap.id,
      }
      artifactGraph.set(boundary.id, boundary)
      kclManager.artifactGraph = artifactGraph
      const radius = kind === 'diameter' ? 8 : 2
      const controls = (
        kind === 'diameter'
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
      ).map(([x, y]) => ({ x: x * radius, y: y * radius, z: 10 }))
      const mock = vi
        .spyOn(engineCommandManager, 'sendSceneCommand')
        .mockImplementation(async (command) => {
          if (command.type !== 'modeling_cmd_req')
            throw new Error('Unexpected command')
          const cmd = command.cmd
          const responses = {
            entity_get_parent_id: { entity_id: sweep.id },
            solid3d_get_all_edge_faces: { faces: [cut.id, cap.id] },
            curve_get_type: { curve_type: 'arc' },
            curve_get_end_points: {
              start: controls[0],
              end: controls[controls.length - 1],
            },
            curve_get_control_points: { control_points: controls },
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
          } as Awaited<ReturnType<typeof engineCommandManager.sendSceneCommand>>
        })
      let result
      try {
        result = await modelingCommandCodemods['GDT Distance'].run({
          ast,
          args: {
            objects: {
              graphSelections: [{ artifact: boundary }],
              otherSelections: [],
            },
          },
          kclManager,
          wasmInstance: instance,
        })
      } finally {
        mock.mockRestore()
      }
      if (result instanceof Error) throw result
      const code = recast(result.modifiedAst, instance)
      if (code instanceof Error) throw code
      expect(code).toContain(`gdt::${kind}(`)
      expect(code.replace(/\s+/g, '')).toContain(
        'target={sideFaces=[rounded,solid.faces.top]}'
      )
      expect(code).toContain('framePlane = XY')
      expect(code).not.toContain('edgeId(')
      await enginelessExecutor(result.modifiedAst, rustContext)
    }
  )
})
