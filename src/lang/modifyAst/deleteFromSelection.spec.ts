import { deleteFromSelection } from '@src/lang/modifyAst/deleteFromSelection'
import {
  codeRefFromRange,
  getArtifactFromRange,
} from '@src/lang/std/artifactGraph'
import { assertParse, getAllOperations, recast } from '@src/lang/wasm'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { expect, it } from 'vitest'

it('removes piped appearance without deleting its extrusion', async () => {
  const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
  const base = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

profile = sketch(on = XY) {
  ring = circle(center = [var 0mm, var 0mm], start = [var 5mm, var 0mm])
}
profileRegion = region(point = [1mm, 0mm], sketch = profile)
solid = extrude(profileRegion, length = 12mm)`
  const appearance = '\n  |> appearance(color = "#7093ad", roughness = 55)'
  const ast = assertParse(base + appearance, instance)
  const execState = await enginelessExecutor(ast, rustContext)
  const operation = getAllOperations(execState.operations).find(
    (op) => op.type === 'StdLibCall' && op.name === 'appearance'
  )
  if (!operation || operation.type !== 'StdLibCall') {
    throw new Error('Could not find appearance operation')
  }
  const result = await deleteFromSelection(
    ast,
    {
      codeRef: codeRefFromRange(operation.sourceRange, ast),
      artifact:
        getArtifactFromRange(operation.sourceRange, execState.artifactGraph) ??
        undefined,
    },
    execState.variables,
    execState.artifactGraph,
    instance
  )
  if (err(result)) throw result
  const codeAfter = recast(result, instance)
  if (err(codeAfter)) throw codeAfter
  expect(codeAfter).toBe(recast(assertParse(base, instance), instance))
  await enginelessExecutor(assertParse(codeAfter, instance), rustContext)
})
