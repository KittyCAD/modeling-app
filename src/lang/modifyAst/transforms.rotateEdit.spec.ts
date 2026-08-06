import { addRotate } from '@src/lang/modifyAst/transforms'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { Artifact, ArtifactGraph, SourceRange } from '@src/lang/wasm'
import { assertParse, recast } from '@src/lang/wasm'
import { getKclCommandValue } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it } from 'vitest'

describe('rotate transform edit flow', () => {
  function rangeFrom(
    code: string,
    startText: string,
    endText?: string
  ): SourceRange {
    const start = code.indexOf(startText)
    const end = endText ? code.indexOf(endText) : code.length
    if (start === -1 || end === -1) {
      throw new Error(`Could not find range for ${startText}`)
    }
    return [start, end, 0]
  }

  it('preserves the edited body reference when a later pattern uses the same body', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
rotate(
  extrude001,
  axis = [0, 0, 1],
  angle = 30deg,
  global = true,
)
pattern001 = patternCircular3d(
  extrude001,
  instances = 3,
  axis = [0, 0, 1],
  center = [0, 0, 0],
)`
    const ast = assertParse(code, instance)
    const extrudeRange = rangeFrom(code, 'extrude001 =', '\nrotate(')
    const rotateRange = rangeFrom(code, 'rotate(', '\npattern001')
    const patternRange = rangeFrom(code, 'pattern001 =')
    const extrudePathToNode = getNodePathFromSourceRange(ast, extrudeRange)
    const rotatePathToNode = getNodePathFromSourceRange(ast, rotateRange)
    const patternPathToNode = getNodePathFromSourceRange(ast, patternRange)
    const sweep: Artifact = {
      type: 'sweep',
      id: 'sweep-id',
      subType: 'extrusion',
      pathId: 'path-id',
      surfaceIds: [],
      edgeIds: [],
      codeRef: {
        range: extrudeRange,
        pathToNode: extrudePathToNode,
        nodePath: { steps: [] },
      },
      trajectoryId: null,
      method: 'new',
      consumed: false,
      patternIds: ['pattern-id'],
    }
    const pattern: Artifact = {
      type: 'pattern',
      id: 'pattern-id',
      subType: 'circular',
      sourceId: 'sweep-id',
      copyIds: [],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef: {
        range: patternRange,
        pathToNode: patternPathToNode,
        nodePath: { steps: [] },
      },
    }
    const artifactGraph: ArtifactGraph = new Map<string, Artifact>([
      [sweep.id, sweep],
      [pattern.id, pattern],
    ])
    const result = addRotate({
      ast,
      artifactGraph,
      objects: {
        graphSelections: [
          {
            artifact: sweep,
            codeRef: {
              range: extrudeRange,
              pathToNode: extrudePathToNode,
            },
          },
        ],
        otherSelections: [],
      },
      axis: await getKclCommandValue('[0, 0, 1]', instance, rustContext),
      angle: await getKclCommandValue('45deg', instance, rustContext),
      global: true,
      nodeToEdit: rotatePathToNode,
      wasmInstance: instance,
    })
    if (err(result)) throw result

    const newCode = recast(result.modifiedAst, instance)
    expect(newCode).toContain(`rotate(
  extrude001,
  axis = [0, 0, 1],
  angle = 45deg,
  global = true,
)`)
    expect(newCode).not.toContain('rotate(pattern001')
  })
})
