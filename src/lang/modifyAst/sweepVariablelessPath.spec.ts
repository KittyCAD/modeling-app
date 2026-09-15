import { addSweep } from '@src/lang/modifyAst/sweeps'
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

describe('sweep with a variable-less path', () => {
  it('materializes the selected path for the labeled path argument', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const code = `profile001 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 5])`
    const ast = assertParse(code, instance)
    const { artifactGraph } = await enginelessExecutor(ast, rustContext)
    const paths = [...artifactGraph.values()].filter(
      (artifact) => artifact.type === 'path'
    )
    expect(paths).toHaveLength(2)

    const result = addSweep({
      ast,
      artifactGraph,
      sketches: createSelectionFromArtifacts([paths[0]], artifactGraph),
      path: createSelectionFromArtifacts([paths[1]], artifactGraph),
      wasmInstance: instance,
    })
    if (err(result)) {
      throw result
    }

    const output = recast(result.modifiedAst, instance)
    expect(output).toContain(`path001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 5])`)
    expect(output).toContain('sweep001 = sweep(')
    expect(output).toContain('path = path001')
    const execution = await enginelessExecutor(result.modifiedAst, rustContext)
    expect(execution.issues).toEqual([])
  })
})
