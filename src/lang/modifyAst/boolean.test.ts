import { addSubtract } from '@src/lang/modifyAst/boolean'
import { assertParse, recast } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { enginelessExecutor } from '@src/lib/testHelpers'
import type { Selections } from '@src/lib/selections'

// addInterset and addUnion are not tested here, as they would be 1:1 with existing e2e tests
// so just adding extra addSubtract cases here

describe('Testing addSubtract', () => {
  async function runAddSubtractTest(code: string, toolCount = 1) {
    const ast = assertParse(code)
    if (err(ast)) throw ast

    const { artifactGraph } = await enginelessExecutor(ast)
    const sweeps = [...artifactGraph.values()].filter((n) => n.type === 'sweep')
    const solids: Selections = {
      graphSelections: sweeps.slice(-1),
      otherSelections: [],
    }
    const tools: Selections = {
      graphSelections: sweeps.slice(0, toolCount),
      otherSelections: [],
    }
    const result = addSubtract({
      ast,
      artifactGraph,
      solids,
      tools,
    })
    if (err(result)) throw result

    await enginelessExecutor(ast)
    return recast(result.modifiedAst)
  }

  it('should add a standalone call on standalone sweeps selection', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0.2, 0.2], radius = 0.1)
extrude001 = extrude(profile001, length = 1)

sketch002 = startSketchOn(XZ)
profile002 = circle(sketch002, center = [0.2, 0.2], radius = 0.05)
extrude002 = extrude(profile002, length = -1)`
    const expectedNewLine = `solid001 = subtract(extrude002, tools = extrude001)`
    const newCode = await runAddSubtractTest(code)
    expect(newCode).toContain(code + '\n' + expectedNewLine)
  })

  it('should push a call in pipe if selection was in variable-less pipe', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0.2, 0.2], radius = 0.1)
extrude001 = extrude(profile001, length = 1)

startSketchOn(XZ)
  |> circle(center = [0.2, 0.2], radius = 0.05)
  |> extrude(length = -1)`
    const expectedNewLine = `  |> subtract(tools = extrude001)`
    const newCode = await runAddSubtractTest(code)
    expect(newCode).toContain(code + '\n' + expectedNewLine)
  })

  it('should support multi-profile extrude as tool', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0.2, 0.2], radius = 0.05)
profile002 = circle(sketch001, center = [0.2, 0.4], radius = 0.05)
extrude001 = extrude([profile001, profile002], length = 1)

sketch003 = startSketchOn(XZ)
profile003 = circle(sketch003, center = [0.2, 0.2], radius = 0.1)
extrude003 = extrude(profile003, length = -1)`
    const expectedNewLine = `solid001 = subtract(extrude003, tools = extrude001)`
    const toolCount = 2
    const newCode = await runAddSubtractTest(code, toolCount)
    expect(newCode).toContain(code + '\n' + expectedNewLine)
  })
})
