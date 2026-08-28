import { addDelete, addHide } from '@src/lang/modifyAst/transforms'
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

describe('object transforms on a variable-less pipe', () => {
  it.each([
    ['hide', addHide],
    ['delete', addDelete],
  ] as const)(
    'keeps %s attached to the selected source pipe',
    async (name, add) => {
      const { instance, rustContext } =
        await buildTheWorldAndNoEngineConnection()
      const code = `@settings(experimentalFeatures = allow)

startSketchOn(XY)
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

      const result = add({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([sweep], artifactGraph),
        wasmInstance: instance,
      })
      if (err(result)) {
        throw result
      }

      const output = recast(result.modifiedAst, instance)
      expect(output).toContain(`  |> extrude(length = 1)\n  |> ${name}()`)
      const execution = await enginelessExecutor(
        result.modifiedAst,
        rustContext
      )
      expect(execution.issues).toEqual([])
    }
  )
})
