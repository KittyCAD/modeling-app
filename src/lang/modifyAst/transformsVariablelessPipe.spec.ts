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
      const code = `@settings(experimentalFeatures = allow, kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  circle1 = circle(start = [1, 0], center = [0, 0])
}
region(segments = [sketch001.circle1])
  |> extrude(length = 1)`
      const ast = assertParse(code, instance)
      const { artifactGraph } = await enginelessExecutor(ast, rustContext)
      const sweep = Array.from(artifactGraph.values()).find(
        (artifact) => artifact.type === 'sweep'
      )
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

  it.each([
    ['hide', addHide, 'hidden001 = hide([solid001, solid002])'],
    ['delete', addDelete, 'delete([solid001, solid002])'],
  ] as const)(
    'keeps every selected source pipe represented for multi-selected %s',
    async (_, add, expectedCall) => {
      const { instance, rustContext } =
        await buildTheWorldAndNoEngineConnection()
      const code = `@settings(experimentalFeatures = allow, kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  circle1 = circle(start = [1, 0], center = [0, 0])
}
region(segments = [sketch001.circle1])
  |> extrude(length = 1)
sketch002 = sketch(on = XZ) {
  circle1 = circle(start = [1, 0], center = [0, 0])
}
region(segments = [sketch002.circle1])
  |> extrude(length = 1)`
      const ast = assertParse(code, instance)
      const { artifactGraph } = await enginelessExecutor(ast, rustContext)
      const sweeps = Array.from(artifactGraph.values()).filter(
        (artifact) => artifact.type === 'sweep'
      )
      expect(sweeps).toHaveLength(2)
      const [firstSweep, secondSweep] = sweeps
      if (!firstSweep || !secondSweep) {
        throw new Error('Expected both pipes to produce a sweep')
      }

      const result = add({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts(
          [firstSweep, firstSweep, secondSweep],
          artifactGraph
        ),
        wasmInstance: instance,
      })
      if (err(result)) {
        throw result
      }

      const output = recast(result.modifiedAst, instance)
      expect(output).toContain(
        'solid001 = region(segments = [sketch001.circle1])'
      )
      expect(output).toContain(
        'solid002 = region(segments = [sketch002.circle1])'
      )
      expect(output).toContain(expectedCall)

      const execution = await enginelessExecutor(
        result.modifiedAst,
        rustContext
      )
      expect(execution.issues).toEqual([])
    }
  )
})
