import type { KclManager } from '@src/lang/KclManager'
import { addSplit, addSubtract } from '@src/lang/modifyAst/boolean'
import { recast } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import {
  createSelectionFromArtifacts,
  enginelessExecutor,
  getAstAndArtifactGraph,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

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

async function getSolidsAndTools(
  code: string,
  solidIds: number[],
  toolIds: number[],
  instance: ModuleType,
  kclManager: KclManager
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

  return { ast, artifactGraph, solids, tools }
}

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
      const { ast, artifactGraph, solids, tools } = await getSolidsAndTools(
        code,
        solidIds,
        toolIds,
        instance,
        kclManager
      )
      const result = addSubtract({
        ast,
        artifactGraph,
        solids,
        tools,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      await enginelessExecutor(ast, rustContext)
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
      const expectedNewLine = `solid001 = subtract(extrude003, tools = [extrude001[0], extrude001[1]])`
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

  describe('Testing addSplit', () => {
    async function runAddSplitTest({
      code,
      targetIds,
      toolIds,
      merge,
      keepTools,
    }: {
      code: string
      targetIds: number[]
      toolIds?: number[]
      merge?: boolean
      keepTools?: boolean
    }) {
      const {
        ast,
        artifactGraph,
        solids: targets,
        tools,
      } = await getSolidsAndTools(
        code,
        targetIds,
        toolIds || [],
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addSplit({
        ast,
        artifactGraph,
        targets,
        ...(toolIds ? { tools } : {}),
        merge,
        keepTools,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      await enginelessExecutor(ast, rustContextInThisFile)
      return recast(result.modifiedAst, instanceInThisFile)
    }

    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 5.53)
extrude001 = extrude(profile001, length = 5, symmetric = true)
sketch002 = startSketchOn(XY)
profile002 = startProfile(sketch002, at = [-8.55, 7.53])
  |> angledLine(angle = 0deg, length = 16.04, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90deg, length = 15.25)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(profile002, length = .1)`

    it('should add a split call with explicit merge true', async () => {
      const expectedNewLine = `split001 = split([extrude001, extrude002], merge = true)`
      const newCode = await runAddSplitTest({
        code,
        targetIds: [0, 1],
        merge: true,
      })
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should emit merge and keepTools when both are false', async () => {
      const expectedNewLine = `split001 = split(
  extrude001,
  tools = extrude002,
  merge = false,
  keepTools = false,
)`
      const newCode = await runAddSplitTest({
        code,
        targetIds: [0],
        toolIds: [1],
        merge: false,
        keepTools: false,
      })
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should emit merge when merge is true', async () => {
      const expectedNewLine = `split001 = split(
  extrude001,
  tools = extrude002,
  merge = true,
  keepTools = false,
)`
      const newCode = await runAddSplitTest({
        code,
        targetIds: [0],
        toolIds: [1],
        merge: true,
        keepTools: false,
      })
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should emit keepTools when keepTools is true', async () => {
      const expectedNewLine = `split001 = split(
  extrude001,
  tools = extrude002,
  merge = false,
  keepTools = true,
)`
      const newCode = await runAddSplitTest({
        code,
        targetIds: [0],
        toolIds: [1],
        merge: false,
        keepTools: true,
      })
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should emit merge then keepTools in a stable order when both are true', async () => {
      const expectedNewLine = `split001 = split(
  extrude001,
  tools = extrude002,
  merge = true,
  keepTools = true,
)`
      const newCode = await runAddSplitTest({
        code,
        targetIds: [0],
        toolIds: [1],
        merge: true,
        keepTools: true,
      })
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should work with a compositeSolid for tools in a more complex part', async () => {
      const code = `sketch001 = sketch(on = YZ) {
  line1 = line(start = [var 7.1mm, var -1.58mm], end = [var 10.16mm, var -1.58mm])
  line2 = line(start = [var 10.16mm, var -1.58mm], end = [var 10.16mm, var 1.33mm])
  line3 = line(start = [var 10.16mm, var 1.33mm], end = [var 7.1mm, var 1.33mm])
  line4 = line(start = [var 7.1mm, var 1.33mm], end = [var 7.1mm, var -1.58mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}
region001 = region(point = [8.63mm, -1.5775mm], sketch = sketch001)
extrude001 = extrude(region001, length = 20, bodyType = SURFACE)

sketch002 = sketch(on = XZ) {
  line1 = line(start = [var 11.27mm, var 4.91mm], end = [var 9.6mm, var -6.31mm])
}
extrude002 = extrude(sketch002.line1, length = 10, bodyType = SURFACE)

sketch003 = sketch(on = YZ) {
  line1 = line(start = [var 16.37mm, var 5.98mm], end = [var 16.6mm, var -5.82mm])
}
extrude003 = extrude(sketch003.line1, length = -10, bodyType = SURFACE)
hidden001 = hide(sketch003)
hidden002 = hide(sketch002)
hidden003 = hide(sketch001)
blend001 = blend([
  getBoundedEdge(extrude002, edge = extrude002.sketch.tags.line1),
  getBoundedEdge(extrude003, edge = extrude003.sketch.tags.line1)
])
surface001 = flipSurface(blend001)
surface002 = joinSurfaces([extrude002, extrude003, surface001])`
      const expectedNewLine = `split001 = split(extrude001, tools = surface002)`

      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const firstSweep = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweep'
      )
      const lastCompositeSolid = [...artifactGraph.values()]
        .filter((artifact) => artifact.type === 'compositeSolid')
        .at(-1)
      if (!firstSweep) {
        throw new Error('sweep artifact not found in graph')
      }
      if (!lastCompositeSolid) {
        throw new Error('compositeSolid artifact not found in graph')
      }

      const targets = createSelectionFromArtifacts([firstSweep], artifactGraph)
      const tools = createSelectionFromArtifacts(
        [lastCompositeSolid],
        artifactGraph
      )

      const result = addSplit({
        ast,
        artifactGraph,
        targets,
        tools,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      await enginelessExecutor(ast, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })
  })
})
