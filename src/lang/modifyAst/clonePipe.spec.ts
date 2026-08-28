import { addClone } from '@src/lang/modifyAst/transforms'
import { assertParse, recast } from '@src/lang/wasm'
import {
  createSelectionFromArtifacts,
  enginelessExecutor,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/commandBarConfigs/modelingCommandStdLibCommands', () => ({
  STD_LIB_COMMANDS: {},
}))

describe('clone variable-less pipe', () => {
  it('keeps the clone input within the source pipe', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)`
    const ast = assertParse(code, instance)
    const { artifactGraph } = await enginelessExecutor(ast, rustContext)
    const sweep = artifactGraph
      .values()
      .find((artifact) => artifact.type === 'sweep')
    if (!sweep) {
      throw new Error('Expected the pipe to produce a sweep')
    }

    const result = addClone({
      ast,
      artifactGraph,
      objects: createSelectionFromArtifacts([sweep], artifactGraph),
      variableName: 'clone001',
      wasmInstance: instance,
    })
    if (err(result)) {
      throw result
    }

    const output = recast(result.modifiedAst, instance)
    expect(output).toContain(`clone001 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> clone()`)
    const execution = await enginelessExecutor(result.modifiedAst, rustContext)
    expect(execution.issues).toEqual([])
  })
})
