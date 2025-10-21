import { assertParse, recast } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { addSubtract } from '@src/lang/modifyAst/boolean'
import { enginelessExecutor } from '@src/lib/testHelpers'
import RustContext from '@src/lib/rustContext'
import { ConnectionManager } from '@src/network/connectionManager'
import { join } from 'path'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')

describe('boolean', () => {
  describe('Testing addSubtract', () => {
    async function runAddSubtractTest(
      code: string,
      solidIds: number[],
      toolIds: number[],
      instance: ModuleType,
      rustContext: RustContext
    ) {
      const ast = assertParse(code, instance)
      if (err(ast)) throw ast

      const { artifactGraph } = await enginelessExecutor(
        ast,
        undefined,
        undefined,
        rustContext
      )
      const sweeps = [...artifactGraph.values()].filter(
        (n) => n.type === 'sweep'
      )
      const solids: Selections = {
        graphSelections: solidIds.map((i) => sweeps[i]),
        otherSelections: [],
      }
      const tools: Selections = {
        graphSelections: toolIds.map((i) => sweeps[i]),
        otherSelections: [],
      }
      const result = addSubtract({
        ast,
        artifactGraph,
        solids,
        tools,
      })
      if (err(result)) throw result

      await enginelessExecutor(ast, undefined, undefined, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should add a standalone call on standalone sweeps selection', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const engineCommandManager = new ConnectionManager()
      const rustContext = new RustContext(engineCommandManager, instance)
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0.2, 0.2], radius = 0.1)
extrude001 = extrude(profile001, length = 1)

sketch002 = startSketchOn(XZ)
profile002 = circle(sketch002, center = [0.2, 0.2], radius = 0.05)
extrude002 = extrude(profile002, length = -1)`
      const expectedNewLine = `solid001 = subtract(extrude002, tools = extrude001)`
      const solidIds = [1]
      const toolIds = [0]
      const newCode = await runAddSubtractTest(
        code,
        solidIds,
        toolIds,
        instance,
        rustContext
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should push a call in pipe if selection was in variable-less pipe', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const engineCommandManager = new ConnectionManager()
      const rustContext = new RustContext(engineCommandManager, instance)
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0.2, 0.2], radius = 0.1)
extrude001 = extrude(profile001, length = 1)

startSketchOn(XZ)
  |> circle(center = [0.2, 0.2], radius = 0.05)
  |> extrude(length = -1)`
      const expectedNewLine = `  |> subtract(tools = extrude001)`
      const solidIds = [1]
      const toolIds = [0]
      const newCode = await runAddSubtractTest(
        code,
        solidIds,
        toolIds,
        instance,
        rustContext
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should support multi-profile extrude as tool', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const engineCommandManager = new ConnectionManager()
      const rustContext = new RustContext(engineCommandManager, instance)
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0.2, 0.2], radius = 0.05)
profile002 = circle(sketch001, center = [0.2, 0.4], radius = 0.05)
extrude001 = extrude([profile001, profile002], length = 1)

sketch003 = startSketchOn(XZ)
profile003 = circle(sketch003, center = [0.2, 0.2], radius = 0.1)
extrude003 = extrude(profile003, length = -1)`
      const expectedNewLine = `solid001 = subtract(extrude003, tools = extrude001)`
      const solidIds = [2]
      const toolIds = [0, 1]
      const newCode = await runAddSubtractTest(
        code,
        solidIds,
        toolIds,
        instance,
        rustContext
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })
    it('should support multi-solid selection for subtract', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const engineCommandManager = new ConnectionManager()
      const rustContext = new RustContext(engineCommandManager, instance)
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
profile002 = circle(sketch001, center = [0, 0], radius = 4.98)
extrude001 = extrude(profile002, length = 5)
plane001 = offsetPlane(XY, offset = 10)
sketch002 = startSketchOn(plane001)
profile003 = circle(sketch002, center = [0, 0], radius = 3.18)
extrude002 = extrude(profile003, length = 5)
sketch003 = startSketchOn(XY)
profile004 = circle(sketch003, center = [0, 0], radius = 1.06)
extrude003 = extrude(profile004, length = 20)`
      const expectedNewLine = `solid001 = subtract([extrude001, extrude002], tools = extrude003)`
      const solidIds = [0, 1]
      const toolIds = [2]
      const newCode = await runAddSubtractTest(
        code,
        solidIds,
        toolIds,
        instance,
        rustContext
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })
  })
})
