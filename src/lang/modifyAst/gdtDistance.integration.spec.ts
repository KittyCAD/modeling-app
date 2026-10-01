import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { addDistanceGdt } from '@src/lang/modifyAst/gdt'
import { type ArtifactGraph, assertParse, recast } from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it } from 'vitest'

describe('distance edge topology', () => {
  it.each(['primitive', 'graph', 'mixed'] as const)(
    'generates distinct endpoints for two hole rims arriving as %s selections',
    async (route) => {
      const { instance } = await buildTheWorldAndNoEngineConnection()
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
      const result = addDistanceGdt({
        ast,
        artifactGraph,
        objects,
        wasmInstance: instance,
      })
      if (result instanceof Error) throw result
      const code = recast(result.modifiedAst, instance)
      expect(code).toContain('edgeId(plate, index = 1)')
      expect(code).toContain('edgeId(plate, index = 2)')
      expect(code).toContain('from = edge001')
      expect(code).toContain('to = edge002')
      expect(code).not.toContain('getCommonEdge')
      expect(code).not.toContain('tolerance =')
    }
  )
})
