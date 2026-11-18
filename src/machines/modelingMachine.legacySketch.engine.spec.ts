import type * as WasmUtilsModule from '@src/lang/wasmUtils'
import { isErr } from '@src/lib/trap'
import { assertParse } from '@src/lang/wasm'
import { legacySketchCases } from '@src/machines/modelingMachine.legacySketch.fixtures'
import {
  findSketchEngineResult,
  recordSketchEngineResult,
  sketchEngineResultContract,
} from '@src/machines/modelingMachine.legacySketch.runtimeFixtures'
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
    async ({ code }) => {
      const ast = assertParse(code, world.instance)
      const expected = findSketchEngineResult(ast)
      if (isErr(expected)) throw expected
      world.kclManager.updateCodeEditor(code)
      await world.kclManager.executeAst({ ast })
      expect(world.kclManager.errors).toEqual([])
      const actual = recordSketchEngineResult(
        ast,
        world.kclManager.execState,
        world.instance
      )
      if (isErr(actual)) throw actual
      expect(sketchEngineResultContract(actual)).toEqual(
        sketchEngineResultContract(expected)
      )
    },
    15_000
  )
})
