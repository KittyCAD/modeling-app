import { describe, expect, it, vi } from 'vitest'

import { addExtrude } from '@src/lang/modifyAst/sweeps'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { Artifact, ArtifactGraph, SourceRange } from '@src/lang/wasm'
import { assertParse, recast } from '@src/lang/wasm'
import { getEventForQueryEntityTypeWithPoint } from '@src/lib/selections'
import { getKclCommandValue } from '@src/lib/testHelpers'
import {
  assertNotErr,
  buildTheWorldAndNoEngineConnection,
} from '@src/unitTestUtils'

describe('extruding selected pattern regions', () => {
  it.each([0, 1])(
    'uses the second input output for copy %s',
    async (copyIndex) => {
      const deps = await buildTheWorldAndNoEngineConnection()
      const code = `@settings(kclVersion = "3.0-preview")
region001 = 0
region002 = 0
copies = patternLinear2d([region001, region002], instances = 3, distance = 8, axis = X)`
      const ast = assertParse(code, deps.instance)
      const range: SourceRange = [
        code.indexOf('patternLinear2d'),
        code.length,
        0,
      ]
      const codeRef = {
        range,
        pathToNode: getNodePathFromSourceRange(ast, range),
        nodePath: { steps: [] },
      }
      const first: Extract<Artifact, { type: 'pattern' }> = {
        type: 'pattern',
        id: 'first-pattern',
        subType: 'transform',
        sourceId: 'first-source',
        copyIds: ['first-copy-1', 'first-copy-2'],
        copyFaceIds: [],
        copyEdgeIds: [],
        codeRef,
      }
      const second: Extract<Artifact, { type: 'pattern' }> = {
        ...first,
        id: 'second-pattern',
        sourceId: 'second-source',
        copyIds: ['second-copy-1', 'second-copy-2'],
      }
      const artifactGraph: ArtifactGraph = new Map<string, Artifact>([
        [first.id, first],
        [second.id, second],
      ])
      vi.spyOn(deps.kclManager, 'ast', 'get').mockReturnValue(ast)
      deps.kclManager.artifactGraph = artifactGraph
      vi.spyOn(deps.engineCommandManager, 'sendSceneCommand').mockResolvedValue(
        { success: false, request_id: 'test-request', errors: [] }
      )
      const event = await getEventForQueryEntityTypeWithPoint(
        {
          entity_id: 'picked-region',
          reference: {
            type: 'region',
            region_id: 'picked-region',
            topology_fallback: {
              parent_id: second.copyIds[copyIndex],
              primitive_index: 1,
            },
          },
        },
        { ...deps, wasmInstance: deps.instance }
      )
      if (
        event?.type !== 'Set selection' ||
        event.data.selectionType !== 'singleCodeCursor'
      ) {
        throw new Error('Expected a selected pattern region')
      }
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches: {
          graphSelections: [event.data.selection],
          otherSelections: [],
        },
        length: await getKclCommandValue('5', deps.instance, deps.rustContext),
        wasmInstance: deps.instance,
      })
      assertNotErr(result)
      expect(recast(result.modifiedAst, deps.instance)).toContain(
        `extrude(copies[${copyIndex + 4}], length = 5)`
      )
    }
  )
})
