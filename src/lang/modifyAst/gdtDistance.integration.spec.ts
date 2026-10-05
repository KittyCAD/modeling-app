import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import { type ArtifactGraph, assertParse, recast } from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it, vi } from 'vitest'

describe('distance edge topology', () => {
  it.each(
    (['primitive', 'graph', 'mixed'] as const).flatMap((route) =>
      [true, false].map((engineBounds) => ({ route, engineBounds }))
    )
  )(
    'generates endpoints and a vertical plane for $route selections with engine bounds $engineBounds',
    async ({ route, engineBounds }) => {
      const { instance, kclManager, engineCommandManager } =
        await buildTheWorldAndNoEngineConnection()
      const ast = assertParse(
        `@settings(defaultLengthUnit = mm, kclVersion = 2)
holeSketch = sketch(on = XY) {
  outer = circle(start = [20mm, 0mm], center = [0mm, 0mm])
  leftHole = circle(start = [-3mm, 0mm], center = [-6mm, 0mm])
  rightHole = circle(start = [9mm, 0mm], center = [6mm, 0mm])
}
plate = extrude(region(point = [0mm, 10mm], sketch = holeSketch), length = 5mm)`,
        instance
      )
      const codeRef = {
        nodePath: { steps: [] },
        range: [0, 0, 0] as [number, number, number],
        pathToNode: createPathToNodeForLastVariable(ast),
      }
      const artifactGraph: ArtifactGraph = new Map([
        [
          'plate-body',
          {
            type: 'sweep',
            id: 'plate-body',
            subType: 'extrusion',
            surfaceIds: [],
            edgeIds: [],
            trajectoryId: null,
            method: 'new',
            consumed: false,
            codeRef,
          },
        ],
      ])
      const objects: Selections = { graphSelections: [], otherSelections: [] }
      for (const index of [1, 2]) {
        if (route === 'graph' || (route === 'mixed' && index === 1)) {
          objects.graphSelections.push({
            entityRef: {
              type: 'edge',
              side_faces: ['top-face', `hole-wall-${index}`],
            },
            engineEntityId: `hole-rim-${index}`,
            engineTopologyFallback: {
              parentId: 'plate-body',
              primitiveIndex: index,
            },
          })
        } else {
          objects.otherSelections.push({
            type: 'enginePrimitive',
            primitiveType: 'edge',
            parentEntityId: 'plate-body',
            primitiveIndex: index,
            entityId: `hole-rim-${index}`,
          })
        }
      }
      kclManager.artifactGraph = artifactGraph
      const sceneCommand = vi
        .spyOn(engineCommandManager, 'sendSceneCommand')
        .mockImplementation(async (command) => ({
          success: true,
          request_id: 'test',
          resp: {
            type: 'modeling',
            data: {
              modeling_response: {
                type: 'bounding_box',
                data: {
                  center: {
                    x: 0,
                    y: 0,
                    z:
                      command.type === 'modeling_cmd_req' &&
                      command.cmd.type === 'bounding_box' &&
                      command.cmd.entity_ids[0] === 'hole-rim-2'
                        ? 3
                        : 0,
                  },
                  dimensions: { x: 4, y: 4, z: 3 },
                },
              },
            },
          },
        }))
      if (!engineBounds)
        sceneCommand.mockRejectedValue(new Error('Bounds unavailable'))
      const result = await modelingCommandCodemods['GDT Distance'].run({
        ast,
        args: { objects },
        kclManager,
        wasmInstance: instance,
      })
      sceneCommand.mockRestore()
      if (result instanceof Error) throw result
      const code = recast(result.modifiedAst, instance)
      expect(code).toContain('edgeId(plate, index = 1)')
      expect(code).toContain('edgeId(plate, index = 2)')
      expect(code).toContain('from = edge001')
      expect(code).toContain('to = edge002')
      expect(code).not.toContain('getCommonEdge')
      expect(code).not.toContain('tolerance =')
      expect(code).toContain('framePlane = XZ')
    }
  )
})
