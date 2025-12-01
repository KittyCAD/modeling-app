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
import { afterAll, expect, beforeEach, describe, it } from 'vitest'
import type { KclManager } from '@src/lang/KclManager'

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
      // path selection is what p&c is doing with the filter (v. sweep)
      const paths = [...artifactGraph.values()].filter((n) => n.type === 'path')
      const solids: Selections = {
        graphSelections: solidIds.map((i) => {
          return {
            artifact: paths[i],
            codeRef: paths[i].codeRef,
          }
        }),
        otherSelections: [],
      }
      const tools: Selections = {
        graphSelections: toolIds.map((i) => {
          return {
            artifact: paths[i],
            codeRef: paths[i].codeRef,
          }
        }),
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
      const carRotorWithExtraBody = `rotorDiameter = 12
rotorInnerDiameter = 6
rotorSinglePlateThickness = 0.25
rotorTotalThickness = 1
spacerLength = rotorTotalThickness - (2 * rotorSinglePlateThickness)

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
      const expectedNewLine = `solid001 = subtract(secondRotor, tools = extrude001)`
      const solidIds = [0]
      const toolIds = [3]
      const newCode = await runAddSubtractTest(
        carRotorWithExtraBody,
        solidIds,
        toolIds,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      // Note that this would fail without artifactTypeFilter: ['compositeSolid', 'sweep'] in addSubtract
      // that's what https://github.com/KittyCAD/modeling-app/pull/8742 caught
      expect(newCode).toContain(carRotorWithExtraBody + '\n' + expectedNewLine)
    })
  })

  // From https://github.com/KittyCAD/modeling-app/blob/d83324ac30430af675806c143ee6fb30df8bdaa8/src/lang/modifyAst/boolean.test.ts#L7
  // addIntersect and addUnion are not tested here, as they would be 1:1 with existing e2e tests
  // so just adding extra addSubtract cases here
})
