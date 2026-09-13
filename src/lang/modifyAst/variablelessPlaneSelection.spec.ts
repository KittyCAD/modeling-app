import { addOffsetPlane } from '@src/lang/modifyAst/faces'
import { addMirror3D } from '@src/lang/modifyAst/transforms'
import { assertParse, recast } from '@src/lang/wasm'
import {
  createSelectionFromArtifacts,
  enginelessExecutor,
  getKclCommandValue,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/commandBarConfigs/modelingCommandStdLibCommands', () => ({
  STD_LIB_COMMANDS: {},
}))

describe('variable-less plane selections', () => {
  it.each(['mirror', 'offset'] as const)(
    'materializes the selected plane for %s',
    async (operation) => {
      const { instance, rustContext } =
        await buildTheWorldAndNoEngineConnection()
      const code = `@settings(experimentalFeatures = allow)

profile001 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
offsetPlane(YZ, offset = 2)`
      const ast = assertParse(code, instance)
      const execution = await enginelessExecutor(ast, rustContext)
      const sweep = [...execution.artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweep'
      )
      const plane = [...execution.artifactGraph.values()]
        .filter((artifact) => artifact.type === 'plane')
        .sort((a, b) => a.codeRef.range[0] - b.codeRef.range[0])
        .at(-1)
      if (!sweep || !plane) {
        throw new Error('Expected a sweep and an offset plane')
      }

      const planeSelection = createSelectionFromArtifacts(
        [plane],
        execution.artifactGraph
      )
      const result =
        operation === 'mirror'
          ? addMirror3D({
              ast,
              artifactGraph: execution.artifactGraph,
              variables: execution.variables,
              bodies: createSelectionFromArtifacts(
                [sweep],
                execution.artifactGraph
              ),
              across: planeSelection,
              wasmInstance: instance,
            })
          : addOffsetPlane({
              ast,
              artifactGraph: execution.artifactGraph,
              variables: execution.variables,
              plane: planeSelection,
              offset: await getKclCommandValue('3', instance, rustContext),
              wasmInstance: instance,
            })
      if (err(result)) {
        throw result
      }

      const output = recast(result.modifiedAst, instance)
      expect(output).toContain('plane001 = offsetPlane(YZ, offset = 2)')
      expect(output).toContain(
        operation === 'mirror'
          ? 'solid001 = mirror3d(extrude001, across = plane001)'
          : 'plane002 = offsetPlane(plane001, offset = 3)'
      )
      const modifiedExecution = await enginelessExecutor(
        result.modifiedAst,
        rustContext
      )
      expect(modifiedExecution.issues).toEqual([])
    }
  )
})
