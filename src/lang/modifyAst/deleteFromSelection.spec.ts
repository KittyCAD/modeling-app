import type { Artifact } from '@src/lang/wasm'
import { assertParse, recast } from '@src/lang/wasm'
import { deleteFromSelection } from '@src/lang/modifyAst/deleteFromSelection'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it } from 'vitest'

describe('deleteFromSelection', () => {
  it('deletes a region and its consuming extrude', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const codeBefore = `s = sketch(on = XY) {
  line1 = line(start = [0, 0], end = [10, 0])
  line2 = line(start = [10, 0], end = [10, 10])
  line3 = line(start = [10, 10], end = [0, 10])
  line4 = line(start = [0, 10], end = [0, 0])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
hidden001 = hide(s)
region001 = region(point = [5mm, 5mm], sketch = s)
extrude001 = extrude(region001, length = 4)`
    const ast = assertParse(codeBefore, instance)
    const execState = await enginelessExecutor(ast, rustContext)
    const regionArtifact = Array.from(execState.artifactGraph.values()).find(
      (artifact): artifact is Extract<Artifact, { type: 'path' }> =>
        artifact.type === 'path' && artifact.subType === 'region'
    )
    if (!regionArtifact) {
      throw new Error('Expected region artifact')
    }

    const newAst = await deleteFromSelection(
      ast,
      {
        codeRef: regionArtifact.codeRef,
        artifact: regionArtifact,
      },
      execState.variables,
      execState.artifactGraph,
      instance,
      async () => ({}) as any
    )
    if (err(newAst)) throw newAst

    const newCode = recast(newAst, instance)
    expect(newCode).not.toContain('region001 = region')
    expect(newCode).not.toContain('extrude001 = extrude')
    expect(newCode).toContain('hidden001 = hide(s)')

    await enginelessExecutor(newAst, rustContext)
  })
})
