import { recast } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { addSubtract } from '@src/lang/modifyAst/boolean'
import {
  enginelessExecutor,
  getAstAndArtifactGraph,
} from '@src/lib/testHelpers'
import type RustContext from '@src/lib/rustContext'
import type { ConnectionManager } from '@src/network/connectionManager'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import type { KclManager } from '@src/lang/KclSingleton'

let instanceInThisFile: ModuleType = null!
let kclManagerInThisFile: KclManager = null!
let engineCommandManagerInThisFile: ConnectionManager = null!
let rustContextInThisFile: RustContext = null!

/**
 * Every it test could build the world and connect to the engine but this is too resource intensive and will
 * spam engine connections.
 *
 * Reuse the world for this file. This is not the same as global singleton imports!
 */
beforeEach(async () => {
  if (instanceInThisFile) {
    return
  }

  const { instance, kclManager, engineCommandManager, rustContext } =
    await buildTheWorldAndConnectToEngine()
  instanceInThisFile = instance
  kclManagerInThisFile = kclManager
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})
afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
})

describe('boolean', () => {
  describe('Testing addSubtract', () => {
    async function runAddSubtractTest(
      code: string,
      solidIds: number[],
      toolIds: number[],
      instance: ModuleType,
      kclManager: KclManager,
      rustContext: RustContext
    ) {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instance,
        kclManager
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
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
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
      const solidIds = [1]
      const toolIds = [0]
      const newCode = await runAddSubtractTest(
        code,
        solidIds,
        toolIds,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
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
      const solidIds = [2]
      const toolIds = [0, 1]
      const newCode = await runAddSubtractTest(
        code,
        solidIds,
        toolIds,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })
    it('should support multi-solid selection for subtract', async () => {
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
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })
    it('should support find the first sweep in case of a method=NEW extrude on face', async () => {
      const carRotorWithExtraBody = `export rotorDiameter = 12
export rotorInnerDiameter = 6
export rotorSinglePlateThickness = 0.25
export rotorTotalThickness = 1
export spacerLength = rotorTotalThickness - (2 * rotorSinglePlateThickness)

rotorSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = rotorDiameter / 2)
rotor = extrude(rotorSketch, length = rotorSinglePlateThickness)

centerSpacer = startSketchOn(rotor, face = START)
  |> circle(center = [0, 0], radius = .25)
  |> extrude(length = spacerLength)

secondaryRotorSketch = startSketchOn(centerSpacer, face = END)
  |> circle(center = [0, 0], radius = rotorDiameter / 2)
secondRotor = extrude(secondaryRotorSketch, length = rotorSinglePlateThickness)

sketch001 = startSketchOn(rotor, face = END)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = -5, method = NEW)`
      // TODO: I don't understand, this should FAIL and find extrude001, this is what happens in P&C
      // before https://github.com/KittyCAD/modeling-app/pull/8742
      const expectedNewLine = `solid001 = subtract(secondRotor, tools = extrude001)`
      const solidIds = [2]
      const toolIds = [3]
      const newCode = await runAddSubtractTest(
        carRotorWithExtraBody,
        solidIds,
        toolIds,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(carRotorWithExtraBody + '\n' + expectedNewLine)
    })
  })

  // TODO: also where are the other ones here? addIntersect and addUnion?
})
