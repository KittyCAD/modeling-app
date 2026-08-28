import {
  addAppearance,
  addMirror3D,
  addRotate,
  addScale,
  addTranslate,
} from '@src/lang/modifyAst/transforms'
import type { Node, Program } from '@src/lang/wasm'
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

describe('transforms on multiple variable-less pipes', () => {
  async function expectValidTransformOutput(
    result: Error | { modifiedAst: Node<Program> },
    expectedCall: string,
    instance: Awaited<
      ReturnType<typeof buildTheWorldAndNoEngineConnection>
    >['instance'],
    rustContext: Awaited<
      ReturnType<typeof buildTheWorldAndNoEngineConnection>
    >['rustContext']
  ) {
    if (err(result)) {
      throw result
    }

    const output = recast(result.modifiedAst, instance)
    expect(output).toContain('solid001 = startSketchOn(XY)')
    expect(output).toContain('solid002 = startSketchOn(XZ)')
    expect(output).toContain(expectedCall)
    expect(output).not.toContain('[%, %]')

    const execution = await enginelessExecutor(result.modifiedAst, rustContext)
    expect(execution.issues).toEqual([])
  }

  it('keeps every selected source body for multi-object transforms', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const code = `@settings(experimentalFeatures = allow)

startSketchOn(XY)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 2)
startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 2)
plane001 = offsetPlane(YZ, offset = 1)`
    const ast = assertParse(code, instance)
    const { artifactGraph, variables } = await enginelessExecutor(
      ast,
      rustContext
    )
    const sweeps = [...artifactGraph.values()].filter(
      (artifact) => artifact.type === 'sweep'
    )
    expect(sweeps).toHaveLength(2)
    const objects = createSelectionFromArtifacts(sweeps, artifactGraph)
    const planes = [...artifactGraph.values()].filter(
      (artifact) => artifact.type === 'plane'
    )
    const plane = planes.at(-1)
    if (!plane) {
      throw new Error('Expected an offset plane for mirror3d')
    }
    const across = createSelectionFromArtifacts([plane], artifactGraph)

    await expectValidTransformOutput(
      addTranslate({
        ast,
        artifactGraph,
        objects,
        x: await getKclCommandValue('1', instance, rustContext),
        wasmInstance: instance,
      }),
      'translate([solid001, solid002], x = 1)',
      instance,
      rustContext
    )

    await expectValidTransformOutput(
      addRotate({
        ast,
        artifactGraph,
        objects,
        roll: await getKclCommandValue('10', instance, rustContext),
        wasmInstance: instance,
      }),
      'rotate([solid001, solid002], roll = 10)',
      instance,
      rustContext
    )

    await expectValidTransformOutput(
      addScale({
        ast,
        artifactGraph,
        objects,
        factor: await getKclCommandValue('2', instance, rustContext),
        wasmInstance: instance,
      }),
      'scale([solid001, solid002], factor = 2)',
      instance,
      rustContext
    )

    await expectValidTransformOutput(
      addAppearance({
        ast,
        artifactGraph,
        objects,
        color: '#ff0000',
        wasmInstance: instance,
      }),
      'appearance([solid001, solid002], color = "#ff0000")',
      instance,
      rustContext
    )

    await expectValidTransformOutput(
      addMirror3D({
        ast,
        artifactGraph,
        variables,
        bodies: objects,
        across,
        wasmInstance: instance,
      }),
      'solid003 = mirror3d([solid001, solid002], across = plane001)',
      instance,
      rustContext
    )
  })
})
