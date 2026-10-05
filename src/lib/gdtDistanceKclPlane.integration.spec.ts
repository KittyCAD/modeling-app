import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { type ArtifactGraph, assertParse } from '@src/lang/wasm'
import { getDistanceFramePlaneFromKcl } from '@src/lib/gdtDistanceKclPlane'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it } from 'vitest'

describe('distance planes from selected KCL', () => {
  it.each(
    [
      ['XY', 'XZ'],
      ['XZ', 'XY'],
      ['YZ', 'XY'],
      ['-XY', 'XZ'],
      ['offsetPlane(XY, offset = 4mm)', 'XZ'],
    ].flatMap(([plane, expected]) =>
      [true, false].map((segments) => ({ plane, expected, segments }))
    )
  )(
    'follows the selected extrusion on $plane with segments $segments, ignoring unrelated sketches',
    async ({ plane, expected, segments }) => {
      const { instance } = await buildTheWorldAndNoEngineConnection()
      const ast = assertParse(
        `@settings(kclVersion = 2.0)
unrelated = sketch(on = YZ) {}
support = ${plane}
profile = sketch(on = support) {
  rim = circle(center = [0mm, 0mm], start = [4mm, 0mm])
}
profileAlias = profile
plate = extrude(region(${segments ? 'segments = [profileAlias.rim]' : 'sketch = profileAlias, point = [0mm, 0mm]'}), length = 10mm)`,
        instance
      )
      const codeRef = {
        range: [0, 0, 0] as [number, number, number],
        nodePath: { steps: [] },
        pathToNode: createPathToNodeForLastVariable(ast),
      }
      const graph: ArtifactGraph = new Map([
        [
          'body',
          {
            type: 'sweep',
            id: 'body',
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
      const selections = {
        graphSelections: [],
        otherSelections: [
          {
            type: 'enginePrimitive' as const,
            primitiveType: 'edge' as const,
            entityId: 'edge',
            primitiveIndex: 1,
            parentEntityId: 'body',
          },
        ],
      }
      expect(getDistanceFramePlaneFromKcl(ast, graph, selections)).toBe(
        expected
      )
      const body = graph.get('body')!
      graph.set('wall1', {
        type: 'wall',
        id: 'wall1',
        cmdId: 'wall1',
        sweepId: body.id,
        segId: '',
        pathIds: [],
        edgeCutEdgeIds: [],
        faceCodeRef: codeRef,
      })
      graph.set('wall2', {
        type: 'wall',
        id: 'wall2',
        cmdId: 'wall2',
        sweepId: body.id,
        segId: '',
        pathIds: [],
        edgeCutEdgeIds: [],
        faceCodeRef: codeRef,
      })
      const walls = {
        graphSelections: [
          { artifact: graph.get('wall1')! },
          { artifact: graph.get('wall2')! },
        ],
        otherSelections: [],
      }
      expect(getDistanceFramePlaneFromKcl(ast, graph, walls)).toBe(
        plane.includes('XY') ? 'XY' : plane
      )
      for (const subType of ['start', 'end'] as const) {
        graph.set(subType, {
          type: 'cap',
          id: subType,
          subType,
          sweepId: body.id,
          edgeCutEdgeIds: [],
          pathIds: [],
          faceCodeRef: codeRef,
          cmdId: subType,
        })
      }
      const rims = {
        graphSelections: ['start', 'end'].map((id) => ({
          entityRef: { type: 'edge' as const, side_faces: [id, 'wall1'] },
        })),
        otherSelections: [],
      }
      expect(getDistanceFramePlaneFromKcl(ast, graph, rims)).toBe(expected)
      rims.graphSelections[0].entityRef.side_faces = ['end', 'wall2']
      expect(getDistanceFramePlaneFromKcl(ast, graph, rims)).toBe(
        plane.includes('XY') ? 'XY' : plane
      )
    }
  )
})
