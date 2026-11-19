import type * as WasmUtilsModule from '@src/lang/wasmUtils'
import { assertParse } from '@src/lang/wasm'
import { legacySketchCases } from '@src/machines/modelingMachine.legacySketch.fixtures'
import { sketchEngineResultContract } from '@src/machines/modelingMachine.legacySketch.engineContract'
import contractsExpected from '@src/machines/modelingMachine.legacySketch.contracts.json'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lang/wasmUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof WasmUtilsModule>()),
  initialiseWasm: async () => {
    const [{ loadAndInitialiseWasmInstance }, path] = await Promise.all([
      import('@src/lang/wasmUtilsNode'),
      import('path'),
    ])
    return loadAndInitialiseWasmInstance(
      path.join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    )
  },
}))

let world: Awaited<ReturnType<typeof buildTheWorldAndConnectToEngine>>
beforeAll(async () => {
  world = await buildTheWorldAndConnectToEngine({
    webrtc: false,
    geometryOnly: true,
  })
  vi.spyOn(world.instance.Context.prototype, 'executeMock').mockRejectedValue(
    new Error('Contract tests must use normal engine execution')
  )
})
afterAll(() => {
  world?.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
  world?.commandBarActor.stop()
  world?.settingsActor.stop()
  vi.restoreAllMocks()
})

// One producer contract per geometry family replaces repeated engine setup in
// the 82 app-flow cases. The existing swept-face tests cover actual face entry.
const contracts = Object.entries(legacySketchCases).map(([family, cases]) => ({
  family,
  code: (
    cases.removeIndividualConstraintsCases[0] ??
    cases.namedConstantConstraint[0]
  ).code,
}))
describe('legacy sketch engine-result contracts', () => {
  it.each(contracts)(
    'matches recorded $family geometry and source references',
    async ({ code, family }) => {
      const ast = assertParse(code, world.instance)
      world.kclManager.updateCodeEditor(code)
      await world.kclManager.executeAst({ ast })
      expect(world.kclManager.errors).toEqual([])
      expect(
        sketchEngineResultContract({
          result: {
            variables: world.kclManager.execState.variables,
            artifacts: [...world.kclManager.execState.artifactGraph.values()],
            defaultPlanes: world.kclManager.execState.defaultPlanes,
          },
        })
      ).toEqual(contractsExpected[family as keyof typeof contractsExpected])
    },
    15_000
  )
})
