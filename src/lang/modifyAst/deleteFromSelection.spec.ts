import { deleteFromSelection } from '@src/lang/modifyAst/deleteFromSelection'
import {
  codeRefFromRange,
  getArtifactFromRange,
  getCodeRefsByArtifactId,
} from '@src/lang/std/artifactGraph'
import type { Artifact } from '@src/lang/wasm'
import { assertParse, getAllOperations, recast } from '@src/lang/wasm'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { expect, it } from 'vitest'

// Each row selects an operation in a pipe and checks the resulting KCL.
// Later stages are removed individually; selecting the initial extrusion removes
// its assignment. Nested calls must be rejected rather than removing their parent.
// Rows contain: selected operation name, appended pipe stage, reject nested call.
it.each([
  ['appearance', 'appearance(color = "#7093ad", roughness = 55)'],
  ['translate', 'translate(x = 10mm, global = true)'],
  ['extrude', 'translate(x = 10mm, global = true)'],
  [
    'translate',
    'union([%, translate(clone(%), x = 1mm, global = true)])',
    true,
  ],
  [
    'patternLinear3d',
    'patternLinear3d(instances = 2, distance = 20mm, axis = X)',
  ],
])(
  'handles %s selection in a pipe containing %s',
  async (name, call, rejectNested = false) => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const sketch = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

profile = sketch(on = XY) {
  ring = circle(center = [var 0mm, var 0mm], start = [var 5mm, var 0mm])
}
profileRegion = region(point = [1mm, 0mm], sketch = profile)`
    const base = `${sketch}\nsolid = extrude(profileRegion, length = 12mm)`
    const suffix =
      name === 'appearance' ? '' : '\n  |> translate(y = 20mm, global = true)'
    const ast = assertParse(`${base}\n  |> ${call}${suffix}`, instance)
    const execState = await enginelessExecutor(ast, rustContext)
    const operation = getAllOperations(execState.operations).find(
      (op) => op.type === 'StdLibCall' && op.name === name
    )
    if (!operation || operation.type !== 'StdLibCall') {
      throw new Error(`Could not find ${name} operation`)
    }
    const result = await deleteFromSelection(
      ast,
      {
        codeRef: codeRefFromRange(operation.sourceRange, ast),
        artifact:
          getArtifactFromRange(
            operation.sourceRange,
            execState.artifactGraph
          ) ?? undefined,
      },
      execState.variables,
      execState.artifactGraph,
      instance
    )
    if (rejectNested) {
      expect(result).toBeInstanceOf(Error)
      return
    }
    if (err(result)) throw result
    const codeAfter = recast(result, instance)
    if (err(codeAfter)) throw codeAfter
    const expected = name === 'extrude' ? sketch : base + suffix
    expect(codeAfter).toBe(recast(assertParse(expected, instance), instance))
    await enginelessExecutor(assertParse(codeAfter, instance), rustContext)
  }
)

// Generalized pipe deletion must preserve geometry selection behavior:
// walls/caps remove the extrusion but keep its sketch; fillets/chamfers remove
// only their finishing stage and keep the extrusion.
it.each(['wall', 'cap', 'fillet', 'chamfer'] as const)(
  'preserves %s deletion',
  async (kind) => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    // Legacy pipes are retained here to cover face references into sketch stages.
    const sketch = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`
    const base = `${sketch}\nextrude001 = extrude(sketch001, length = 15)`
    const isFace = kind === 'wall' || kind === 'cap'
    const code = isFace
      ? base
      : `${base}\n  |> ${kind}(${kind === 'fillet' ? 'radius' : 'length'} = 1, tags = [seg01])`
    const ast = assertParse(code, instance)
    const state = await enginelessExecutor(ast, rustContext)
    let artifact: Artifact | undefined
    if (isFace) {
      const sweep = [...state.artifactGraph.values()].find(
        (a) => a.type === 'sweep'
      )
      const segment = [...state.artifactGraph.values()].find(
        (a) => a.type === 'segment'
      )
      if (!sweep || !segment) throw new Error('Missing extrusion or segment')
      // Mock execution omits engine-created faces; supply the face at that boundary.
      const face = {
        id: 'face',
        sweepId: sweep.id,
        pathIds: [],
        edgeCutEdgeIds: [],
        faceCodeRef: segment.codeRef,
        cmdId: 'face-command',
      }
      artifact =
        kind === 'wall'
          ? { type: 'wall', ...face, segId: segment.id }
          : { type: 'cap', ...face, subType: 'end' }
      state.artifactGraph.set(artifact.id, artifact)
      sweep.surfaceIds.push(artifact.id)
    } else {
      artifact = [...state.artifactGraph.values()].find(
        (a) => a.type === 'edgeCut'
      )
    }
    if (!artifact) throw new Error('Missing selected artifact')
    const ref = getCodeRefsByArtifactId(artifact.id, state.artifactGraph)?.[0]
    if (!ref) throw new Error('Missing selection reference')
    const result = await deleteFromSelection(
      ast,
      { artifact, codeRef: codeRefFromRange(ref.range, ast) },
      state.variables,
      state.artifactGraph,
      instance
    )
    if (err(result)) throw result
    expect(recast(result, instance)).toBe(
      recast(assertParse(isFace ? sketch : base, instance), instance)
    )
  }
)
