import { getNextAvailableDatumName } from '@src/lang/modifyAst/gdt'
import { assertParse } from '@src/lang/wasm'
import { modelingMachineCommandConfig } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it } from 'vitest'

type HiddenArg = {
  hidden: (context: {
    argumentsToSubmit: Record<string, unknown>
    selectedCommand?: unknown
  }) => boolean
}

describe('GDT Datum Default Name', () => {
  it('should work with command bar when datum A already exists', async () => {
    // Test command bar integration with existing datum
    const codeWithDatum = `@settings(experimentalFeatures = allow)
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
gdt::datum(face = capEnd001, name = "A")`

    const { instance } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(codeWithDatum, instance)

    // Should return 'B' since 'A' is already used
    expect(getNextAvailableDatumName(ast)).toBe('B')
  })
})

describe('modeling command edit-flow arguments', () => {
  it('only suppresses edit-flow selection arguments when rollback is unavailable', () => {
    const sketchesArg = (
      modelingMachineCommandConfig as Record<
        string,
        { args?: Record<string, unknown> }
      >
    ).Extrude.args?.sketches as unknown as HiddenArg

    expect(
      sketchesArg.hidden({
        argumentsToSubmit: { nodeToEdit: [['body', 0]] },
      })
    ).toBe(true)

    expect(
      sketchesArg.hidden({
        argumentsToSubmit: { nodeToEdit: [['body', 0]] },
        selectedCommand: {
          machineActor: {
            getSnapshot: () => ({
              context: {
                engineCommandManager: { currentEngine: 'open_cascade' },
              },
            }),
          },
        },
      })
    ).toBe(false)
  })
})
