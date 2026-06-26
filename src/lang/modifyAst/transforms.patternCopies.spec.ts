import { describe, expect, it } from 'vitest'

import { addHide } from '@src/lang/modifyAst/transforms'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { Artifact } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import { assertParse, getAllOperations, recast } from '@src/lang/wasm'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

describe('pattern copy transform AST mods', () => {
  async function getPatternFixture() {
    const { instance } = await buildTheWorldAndNoEngineConnection()
    const code = `extrude001 = 0
pattern001 = patternLinear3d(extrude001, instances = 3, distance = 10, axis = [0, 0, 1])`
    const ast = assertParse(code, instance)
    const sourceRange: [number, number, number] = [0, code.indexOf('\n'), 0]
    const sourcePathToNode = getNodePathFromSourceRange(ast, sourceRange)
    const patternRange: [number, number, number] = [
      code.indexOf('patternLinear3d'),
      code.length,
      0,
    ]
    const patternPathToNode = getNodePathFromSourceRange(ast, patternRange)
    const pattern: Artifact = {
      type: 'pattern',
      id: 'pattern-command-id',
      subType: 'linear',
      sourceId: 'source-body-id',
      copyIds: ['copy-body-1', 'copy-body-2'],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef: {
        range: patternRange,
        pathToNode: patternPathToNode,
        nodePath: { steps: [] },
      },
    }
    const artifactGraph: ArtifactGraph = new Map([[pattern.id, pattern]])

    return {
      artifactGraph,
      ast,
      code,
      instance,
      pattern,
      patternPathToNode,
      patternRange,
      sourcePathToNode,
      sourceRange,
    }
  }

  it('uses index 0 for copied pattern source body selections', async () => {
    const {
      artifactGraph,
      ast,
      instance,
      pattern,
      patternPathToNode,
      patternRange,
    } = await getPatternFixture()
    const result = addHide({
      ast,
      artifactGraph,
      objects: {
        graphSelections: [
          {
            artifact: pattern,
            codeRef: {
              range: patternRange,
              pathToNode: patternPathToNode,
            },
            engineEntityId: 'source-body-id',
            patternIndex: 0,
          },
        ],
        otherSelections: [],
      },
      wasmInstance: instance,
    })
    if (err(result)) throw result

    expect(recast(result.modifiedAst, instance)).toContain(
      'hidden001 = hide(pattern001[0])'
    )
  })

  it('uses indexed pattern copy expressions for copied pattern body selections', async () => {
    const {
      artifactGraph,
      ast,
      instance,
      pattern,
      patternPathToNode,
      patternRange,
    } = await getPatternFixture()
    const result = addHide({
      ast,
      artifactGraph,
      objects: {
        graphSelections: [
          {
            artifact: pattern,
            codeRef: {
              range: patternRange,
              pathToNode: patternPathToNode,
            },
            engineEntityId: 'copy-body-1',
            patternIndex: 1,
          },
        ],
        otherSelections: [],
      },
      wasmInstance: instance,
    })
    if (err(result)) throw result

    expect(recast(result.modifiedAst, instance)).toContain(
      'hidden001 = hide(pattern001[1])'
    )
  })

  it('uses the pattern variable when the body selection code ref points at the source', async () => {
    const {
      artifactGraph,
      ast,
      instance,
      pattern,
      sourcePathToNode,
      sourceRange,
    } = await getPatternFixture()
    const result = addHide({
      ast,
      artifactGraph,
      objects: {
        graphSelections: [
          {
            artifact: pattern,
            codeRef: {
              range: sourceRange,
              pathToNode: sourcePathToNode,
            },
            engineEntityId: 'copy-body-1',
            patternIndex: 1,
          },
        ],
        otherSelections: [],
      },
      wasmInstance: instance,
    })
    if (err(result)) throw result

    expect(recast(result.modifiedAst, instance)).toContain(
      'hidden001 = hide(pattern001[1])'
    )
  })

  it('executes hide for a copied pattern body index', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [1, 0])
  |> line(end = [0, 1])
  |> line(end = [-1, 0])
  |> close()
extrude001 = extrude(sketch001, length = 1)
pattern001 = patternLinear3d(extrude001, instances = 3, distance = 5, axis = X)
hidden001 = hide(pattern001[1])`
    const ast = assertParse(code, instance)
    const execState = await enginelessExecutor(ast, rustContext)

    expect(execState.issues).toEqual([])
    expect(
      getAllOperations(execState.operations).some(
        (op) => op.type === 'StdLibCall' && op.name === 'hide'
      )
    ).toBe(true)
  })
})
