import { deleteFromSelection } from '@src/lang/modifyAst/deleteFromSelection'
import {
  codeRefFromRange,
  getArtifactFromRange,
} from '@src/lang/std/artifactGraph'
import { assertParse, getAllOperations, recast } from '@src/lang/wasm'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it } from 'vitest'

describe('Deleting operations from a pipe', () => {
  it('preserves a standalone Scale when deleting its piped Rotate', async () => {
    const { instance } = await buildTheWorldAndNoEngineConnection()
    const base = `@settings(kclVersion = 3.0)
import "bracket.kcl" as bracket
scale(bracket, factor = 1.2)`
    const rotate = 'rotate(axis = Z, angle = 0.2)'
    const code = `${base}\n  |> ${rotate}`
    const ast = assertParse(code, instance)
    const start = code.indexOf(rotate)
    const result = await deleteFromSelection(
      ast,
      { codeRef: codeRefFromRange([start, start + rotate.length, 0], ast) },
      {},
      new Map(),
      instance
    )
    if (err(result)) throw result
    expect(recast(result, instance)).toBe(
      recast(assertParse(base, instance), instance)
    )
  })

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
      const { instance, rustContext } =
        await buildTheWorldAndNoEngineConnection()
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
})
