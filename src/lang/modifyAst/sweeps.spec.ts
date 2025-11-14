import { assertParse, recast, type Program, type Name } from '@src/lang/wasm'
import {
  createSelectionFromArtifacts,
  createSelectionFromPathArtifact,
  enginelessExecutor,
  getAstAndArtifactGraph,
  getAstAndSketchSelections,
  getCapFromCylinder,
  getFacesFromBox,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import type { Selections } from '@src/machines/modelingSharedTypes'
import {
  buildTheWorldAndConnectToEngine,
  buildTheWorldAndNoEngineConnection,
} from '@src/unitTestUtils'
import type RustContext from '@src/lib/rustContext'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { KclManager } from '@src/lang/KclSingleton'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import {
  addExtrude,
  addLoft,
  addRevolve,
  addSweep,
  getAxisExpressionAndIndex,
  retrieveAxisOrEdgeSelectionsFromOpArg,
} from '@src/lang/modifyAst/sweeps'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { ConnectionManager } from '@src/network/connectionManager'
import { mockExecAstAndReportErrors } from '@src/lang/modelingWorkflows'

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

async function runNewAstAndCheckForSweep(
  ast: Node<Program>,
  rustContext: RustContext
) {
  const { artifactGraph } = await enginelessExecutor(
    ast,
    undefined,
    undefined,
    rustContext
  )
  const sweepArtifact = artifactGraph.values().find((a) => a.type === 'sweep')
  expect(sweepArtifact).toBeDefined()
}

async function getKclCommandValue(
  value: string,
  instance: ModuleType,
  rustContext: RustContext
) {
  const result = await stringToKclExpression(
    value,
    undefined,
    instance,
    rustContext
  )
  if (err(result) || 'errors' in result) {
    throw new Error('Failed to create KCL expression')
  }
  return result
}

// TODO: two different methods for the same thing. Why?
async function getAstAndArtifactGraphEngineless(
  code: string,
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
  return { ast, artifactGraph }
}

async function getAstAndSketchSelectionsEngineless(
  code: string,
  instance: ModuleType,
  rustContext: RustContext
) {
  const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
    code,
    instance,
    rustContext
  )
  const artifacts = [...artifactGraph.values()].filter((a) => a.type === 'path')
  if (artifacts.length === 0) {
    throw new Error('Artifact not found in the graph')
  }
  const sketches = createSelectionFromPathArtifact(artifacts)
  return { artifactGraph, ast, sketches }
}

describe('sweeps.test.ts', () => {
  const circleProfileCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)`
  const circleAndRectProfilesCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
profile002 = rectangle(
  sketch001,
  corner = [2, 2],
  width = 2,
  height = 2,
)`

  describe('Testing addExtrude', () => {
    it('should add a basic extrude call', async () => {
      const { ast, sketches, artifactGraph } = await getAstAndSketchSelections(
        circleProfileCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({ ast, sketches, length, artifactGraph })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(`extrude001 = extrude(profile001, length = 1)`)
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a basic multi-profile extrude call', async () => {
      const { ast, sketches, artifactGraph } =
        await getAstAndSketchSelectionsEngineless(
          circleAndRectProfilesCode,
          instanceInThisFile,
          rustContextInThisFile
        )
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({ ast, sketches, length, artifactGraph })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude([profile001, profile002], length = 1)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add an extrude call with symmetric true', async () => {
      const { ast, sketches, artifactGraph } = await getAstAndSketchSelections(
        circleProfileCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        symmetric: true,
        artifactGraph,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude(profile001, length = 1, symmetric = true)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add an extrude call with bidirectional length and twist angle', async () => {
      const { ast, sketches, artifactGraph } = await getAstAndSketchSelections(
        circleProfileCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const length = await getKclCommandValue(
        '10',
        instanceInThisFile,
        rustContextInThisFile
      )
      const bidirectionalLength = await getKclCommandValue(
        '20',
        instanceInThisFile,
        rustContextInThisFile
      )
      const twistAngle = await getKclCommandValue(
        '30',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        bidirectionalLength,
        twistAngle,
        artifactGraph,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(`extrude001 = extrude(
  profile001,
  length = 10,
  bidirectionalLength = 20,
  twistAngle = 30,
)`)
    })

    it('should edit an extrude call from symmetric true to false and new length', async () => {
      const extrudeCode = `${circleProfileCode}
extrude001 = extrude(profile001, length = 1, symmetric = true)`
      const { ast, sketches, artifactGraph } =
        await getAstAndSketchSelectionsEngineless(
          extrudeCode,
          instanceInThisFile,
          rustContextInThisFile
        )
      const length = await getKclCommandValue(
        '2',
        instanceInThisFile,
        rustContextInThisFile
      )
      const symmetric = false
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addExtrude({
        ast,
        sketches,
        length,
        symmetric,
        nodeToEdit,
        artifactGraph,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`${circleProfileCode}
extrude001 = extrude(profile001, length = 2)`)
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add an extrude call with method NEW', async () => {
      const { ast, sketches, artifactGraph } = await getAstAndSketchSelections(
        circleProfileCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        method: 'NEW',
        artifactGraph,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude(profile001, length = 1, method = NEW)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add an extrude call to a wall', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> angledLine(angle = 0deg, length = 0.07, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90deg, length = 0.07)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 1)
plane001 = offsetPlane(XZ, offset = 1)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 0.1)`
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        1
      )
      const to = getFacesFromBox(artifactGraph, 1)
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        to,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `extrude002 = extrude(profile002, to = rectangleSegmentA001)`
      )
      const error = await mockExecAstAndReportErrors(
        result.modifiedAst,
        rustContextInThisFile
      )
      expect(error).not.toBeInstanceOf(Error)
    })

    it('should add an extrude call to an untagged wall', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 1)
  |> line(endAbsolute = [0, 1])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 1)
plane001 = offsetPlane(XZ, offset = 1)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 0.1)`
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        1
      )
      const to = getFacesFromBox(artifactGraph, 1)
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        to,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 1, tag = $seg01)
  |> line(endAbsolute = [0, 1])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 1)
plane001 = offsetPlane(XZ, offset = 1)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 0.1)
extrude002 = extrude(profile002, to = seg01)`)
      const error = await mockExecAstAndReportErrors(
        result.modifiedAst,
        rustContextInThisFile
      )
      expect(error).not.toBeInstanceOf(Error)
    })

    it('should add an extrude call to an end cap', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
plane001 = offsetPlane(XY, offset = 2)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 0.1)`
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        1
      )
      const to = getCapFromCylinder(artifactGraph)
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        to,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1, tagEnd = $capEnd001)
plane001 = offsetPlane(XY, offset = 2)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 0.1)
extrude002 = extrude(profile002, to = capEnd001)`)
      const error = await mockExecAstAndReportErrors(
        result.modifiedAst,
        rustContextInThisFile
      )
      expect(error).not.toBeInstanceOf(Error)
    })

    // TODO: this isn't producing the right results yet
    // https://github.com/KittyCAD/engine/issues/3855
    // and https://github.com/KittyCAD/modeling-app/issues/8831
    it('should add an extrude call to a chamfer face', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 1, tag = $seg01)
  |> line(endAbsolute = [0, 1])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 1, tagEnd = $capEnd001)
  |> chamfer(
       length = 0.5,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
     )
plane001 = offsetPlane(XY, offset = 2)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 0.1)`
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        1
      )
      const to = createSelectionFromArtifacts(
        [...artifactGraph.values()].filter((a) => a.type === 'edgeCut'),
        artifactGraph
      )
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        to,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 1, tag = $seg01)
  |> line(endAbsolute = [0, 1])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 1, tagEnd = $capEnd001)
  |> chamfer(
       length = 0.5,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
       tag = $seg02,
     )
plane001 = offsetPlane(XY, offset = 2)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 0.1)
extrude002 = extrude(profile002, to = seg02)`)
      const error = await mockExecAstAndReportErrors(
        result.modifiedAst,
        rustContextInThisFile
      )
      expect(error).not.toBeInstanceOf(Error)
    })
  })

  describe('Testing addSweep', () => {
    const circleAndLineCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
sketch002 = startSketchOn(XZ)
profile002 = startProfile(sketch002, at = [0, 0])
  |> xLine(length = -5)
  |> tangentialArc(endAbsolute = [-20, 5])`

    async function getAstAndSketchesForSweep(
      code: string,
      instance: ModuleType,
      kclManager: KclManager
    ) {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instance,
        kclManager
      )
      const artifact1 = [...artifactGraph.values()].find(
        (a) => a.type === 'path'
      )
      const artifact2 = [...artifactGraph.values()].findLast(
        (a) => a.type === 'path'
      )
      if (!artifact1 || !artifact2) {
        throw new Error('Artifact not found in the graph')
      }

      const sketches = createSelectionFromPathArtifact([artifact1])
      const path = createSelectionFromPathArtifact([artifact2])
      return { ast, sketches, path }
    }

    it('should add a basic sweep call', async () => {
      const { ast, sketches, path } = await getAstAndSketchesForSweep(
        circleAndLineCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addSweep({ ast, sketches, path })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleAndLineCode)
      expect(newCode).toContain(
        `sweep001 = sweep(profile001, path = profile002)`
      )
    })

    it('should add a sweep call with sectional true and relativeTo setting', async () => {
      const { ast, sketches, path } = await getAstAndSketchesForSweep(
        circleAndLineCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sectional = true
      const relativeTo = 'sketchPlane'
      const result = addSweep({ ast, sketches, path, sectional, relativeTo })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleAndLineCode)
      expect(newCode).toContain(`sweep001 = sweep(
  profile001,
  path = profile002,
  sectional = true,
  relativeTo = "sketchPlane",
)`)
    })

    it('should edit sweep call with sectional from true to false and relativeTo setting change', async () => {
      const circleAndLineCodeWithSweep = `${circleAndLineCode}
sweep001 = sweep(
  profile001,
  path = profile002,
  sectional = true,
  relativeTo = 'sketchPlane',
)`
      const { ast, sketches, path } = await getAstAndSketchesForSweep(
        circleAndLineCodeWithSweep,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sectional = false
      const relativeTo = 'trajectoryCurve'
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addSweep({
        ast,
        sketches,
        path,
        sectional,
        relativeTo,
        nodeToEdit,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleAndLineCode)
      expect(newCode).toContain(
        `sweep001 = sweep(profile001, path = profile002, relativeTo = "trajectoryCurve")`
      )
    })

    it('should add a muli-profile sweep call', async () => {
      const circleAndLineAndRectProfilesCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
profile002 = rectangle(
  sketch001,
  corner = [2, 2],
  width = 2,
  height = 2,
)
sketch002 = startSketchOn(XZ)
profile003 = startProfile(sketch002, at = [0, 0])
  |> xLine(length = -5)
  |> tangentialArc(endAbsolute = [-20, 5])`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        circleAndLineAndRectProfilesCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const artifacts = [...artifactGraph.values()].filter(
        (a) => a.type === 'path'
      )
      if (artifacts.length !== 3) {
        throw new Error('Artifacts not found in the graph')
      }

      const sketches = createSelectionFromPathArtifact([
        artifacts[0],
        artifacts[1],
      ])
      const path = createSelectionFromPathArtifact([artifacts[2]])
      const result = addSweep({ ast, sketches, path })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleAndLineAndRectProfilesCode)
      expect(newCode).toContain(
        `sweep001 = sweep([profile001, profile002], path = profile003)`
      )
    })

    // Note: helix sweep will be done in e2e since helix artifacts aren't created by the engineless executor
  })

  describe('Testing addLoft', () => {
    const twoCirclesCode = `sketch001 = startSketchOn(XZ)
profile001 = circle(sketch001, center = [0, 0], radius = 30)
plane001 = offsetPlane(XZ, offset = 50)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 20)
`
    it('should add a basic loft call', async () => {
      const { ast, sketches } = await getAstAndSketchSelections(
        twoCirclesCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(sketches.graphSelections).toHaveLength(2)
      const result = addLoft({
        ast,
        sketches,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(twoCirclesCode)
      expect(newCode).toContain(`loft001 = loft([profile001, profile002]`)
      // Don't think we can find the artifact here for loft?
    })

    it('should edit a loft call with vDegree', async () => {
      const twoCirclesCodeWithLoft = `${twoCirclesCode}
loft001 = loft([profile001, profile002])`
      const { ast, sketches } = await getAstAndSketchSelections(
        twoCirclesCodeWithLoft,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(sketches.graphSelections).toHaveLength(2)
      const vDegree = await getKclCommandValue(
        '3',
        instanceInThisFile,
        rustContextInThisFile
      )
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addLoft({
        ast,
        sketches,
        vDegree,
        nodeToEdit,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(twoCirclesCode)
      expect(newCode).toContain(
        `loft001 = loft([profile001, profile002], vDegree = 3)`
      )
      // Don't think we can find the artifact here for loft?
    })
  })

  describe('Testing addRevolve', () => {
    const circleCode = `sketch001 = startSketchOn(XZ)
profile001 = circle(sketch001, center = [3, 0], radius = 1)`

    it('should add basic revolve call', async () => {
      const { ast, sketches } = await getAstAndSketchSelections(
        circleCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(sketches.graphSelections).toHaveLength(1)
      const angle = await getKclCommandValue(
        '10',
        instanceInThisFile,
        rustContextInThisFile
      )
      const axis = 'X'
      const result = addRevolve({ ast, sketches, angle, axis })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleCode)
      expect(newCode).toContain(
        `revolve001 = revolve(profile001, angle = 10, axis = X)`
      )
    })

    it('should add basic revolve call with symmetric true', async () => {
      const { ast, sketches } = await getAstAndSketchSelections(
        circleCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(sketches.graphSelections).toHaveLength(1)
      const angle = await getKclCommandValue(
        '10',
        instanceInThisFile,
        rustContextInThisFile
      )
      const axis = 'X'
      const symmetric = true
      const result = addRevolve({
        ast,
        sketches,
        angle,
        axis,
        symmetric,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleCode)
      expect(newCode).toContain(`revolve001 = revolve(
  profile001,
  angle = 10,
  axis = X,
  symmetric = true,
)`)
    })

    it('should add a basic multi-profile revolve call', async () => {
      const { ast, sketches } = await getAstAndSketchSelections(
        circleAndRectProfilesCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const angle = await getKclCommandValue(
        '10',
        instanceInThisFile,
        rustContextInThisFile
      )
      const axis = 'X'
      const result = addRevolve({
        ast,
        sketches,
        angle,
        axis,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `revolve001 = revolve([profile001, profile002], angle = 10, axis = X)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add revolve call around edge', async () => {
      const code = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [-102.57, 101.72])
  |> angledLine(angle = 0, length = 202.6, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 202.6, tag = $rectangleSegmentB001)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 50)
sketch002 = startSketchOn(extrude001, face = rectangleSegmentA001)
  |> circle(center = [-11.34, 10.0], radius = 8.69)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const artifacts = [...artifactGraph.values()]
      const circleArtifact = artifacts.findLast((a) => a.type === 'path')
      if (!circleArtifact) throw new Error('Circle artifact not found in graph')
      const sketches = createSelectionFromPathArtifact([circleArtifact])
      const edgeArtifact = artifacts.find((a) => a.type === 'segment')
      if (!edgeArtifact) throw new Error('Edge artifact not found in graph')
      const edge = createSelectionFromPathArtifact([edgeArtifact])
      const angle = await getKclCommandValue(
        '20',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addRevolve({ ast, sketches, angle, edge })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(code)
      expect(newCode).toContain(
        `revolve001 = revolve(sketch002, angle = 20, axis = rectangleSegmentA001`
      )
    })

    it('should add revolve call around line segment from sketch', async () => {
      const code = `sketch001 = startSketchOn(-XY)
  |> startProfile(at = [-0.48, 1.25])
  |> angledLine(angle = 0, length = 2.38, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 2.4, tag = $rectangleSegmentB001)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 5)
sketch003 = startSketchOn(extrude001, face = START)
  |> circle(center = [-0.69, 0.56], radius = 0.28)
sketch002 = startSketchOn(XY)
  |> startProfile(at = [-2.02, 1.79])
  |> xLine(length = 2.6)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const artifacts = [...artifactGraph.values()]
      const circleArtifact = artifacts.findLast((a) => a.type === 'path')
      if (!circleArtifact) throw new Error('Circle artifact not found in graph')
      const sketches = createSelectionFromPathArtifact([circleArtifact])
      const edgeArtifact = artifacts.findLast((a) => a.type === 'segment')
      if (!edgeArtifact) throw new Error('Edge artifact not found in graph')
      const edge = createSelectionFromPathArtifact([edgeArtifact])
      const angle = await getKclCommandValue(
        '360',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addRevolve({ ast, sketches, angle, edge })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(
        newCode
      ).toContain(`sketch003 = startSketchOn(extrude001, face = START)
  |> circle(center = [-0.69, 0.56], radius = 0.28)
sketch002 = startSketchOn(XY)
  |> startProfile(at = [-2.02, 1.79])
  |> xLine(length = 2.6, tag = $seg01)
revolve001 = revolve(sketch002, angle = 360, axis = seg01)`)
    })

    it('should edit revolve call, changing axis and setting both lengths', async () => {
      const code = `${circleCode}
revolve001 = revolve(profile001, angle = 10, axis = X)`
      const { ast, sketches } = await getAstAndSketchSelectionsEngineless(
        code,
        instanceInThisFile,
        rustContextInThisFile
      )
      expect(sketches.graphSelections).toHaveLength(1)
      const angle = await getKclCommandValue(
        '20',
        instanceInThisFile,
        rustContextInThisFile
      )
      const bidirectionalAngle = await getKclCommandValue(
        '30',
        instanceInThisFile,
        rustContextInThisFile
      )
      const axis = 'Y'
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addRevolve({
        ast,
        sketches,
        angle,
        bidirectionalAngle,
        axis,
        nodeToEdit,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleCode)
      expect(newCode).toContain(`revolve001 = revolve(
  profile001,
  angle = 20,
  axis = Y,
  bidirectionalAngle = 30,
)`)
    })
  })

  describe('Testing getAxisExpressionAndIndex', () => {
    it.each(['X', 'Y', 'Z'])(
      'should return axis expression for default axis %s',
      async (axis) => {
        const { instance } = await buildTheWorldAndNoEngineConnection()
        const ast = assertParse('', instance)
        const result = getAxisExpressionAndIndex(axis, undefined, ast)
        if (err(result)) throw result
        expect(result.generatedAxis.type).toEqual('Name')
        expect((result.generatedAxis as Node<Name>).name.name).toEqual(axis)
      }
    )

    it('should return a generated axis pointing to the selected segment', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 1)`,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const edgeArtifact = [...artifactGraph.values()].find(
        (a) => a.type === 'segment'
      )
      const edge: Selections = createSelectionFromPathArtifact([edgeArtifact!])
      const result = getAxisExpressionAndIndex(undefined, edge, ast)
      if (err(result)) throw result
      expect(result.generatedAxis.type).toEqual('Name')
      expect((result.generatedAxis as Node<Name>).name.name).toEqual('seg01')
      expect(recast(ast, instanceInThisFile)).toContain(
        `xLine(length = 1, tag = $seg01)`
      )
    })

    it('should error if nothing is provided', async () => {
      const { instance } = await buildTheWorldAndNoEngineConnection()
      const result = getAxisExpressionAndIndex(
        undefined,
        undefined,
        assertParse('', instance)
      )
      expect(result).toBeInstanceOf(Error)
    })
  })

  describe('Testing retrieveAxisOrEdgeSelectionsFromOpArg', () => {
    it.each(['X', 'Y', 'Z'])(
      'should return axis selection from axis op argument %s',
      async (axis) => {
        const helixCode = `helix001 = helix(
  axis = ${axis},
  revolutions = 1,
  angleStart = 0,
  radius = 1,
  length = 1,
)`
        const ast = assertParse(helixCode, instanceInThisFile)
        const { artifactGraph, operations } = await enginelessExecutor(
          ast,
          undefined,
          undefined,
          rustContextInThisFile
        )
        const op = operations.find(
          (o) => o.type === 'StdLibCall' && o.name === 'helix'
        )
        if (!op || op.type !== 'StdLibCall' || !op.labeledArgs.axis) {
          throw new Error('Helix operation not found')
        }

        const result = retrieveAxisOrEdgeSelectionsFromOpArg(
          op.labeledArgs.axis,
          artifactGraph
        )
        if (err(result)) throw result
        expect(result.axisOrEdge).toEqual('Axis')
        expect(result.axis).toEqual(axis)
        expect(result.edge).toBeUndefined()
      }
    )

    it('should return edge selection from axis op argument', async () => {
      const helixCode = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = 1, tag = $seg01)
helix001 = helix(
  axis = seg01,
  revolutions = 1,
  angleStart = 0,
  radius = 1,
)`
      const ast = assertParse(helixCode, instanceInThisFile)
      const { artifactGraph, operations } = await enginelessExecutor(
        ast,
        undefined,
        undefined,
        rustContextInThisFile
      )
      const op = operations.find(
        (o) => o.type === 'StdLibCall' && o.name === 'helix'
      )
      if (!op || op.type !== 'StdLibCall' || !op.labeledArgs.axis) {
        throw new Error('Helix operation not found')
      }
      const result = retrieveAxisOrEdgeSelectionsFromOpArg(
        op.labeledArgs.axis,
        artifactGraph
      )
      if (err(result)) throw result
      const segId = [...artifactGraph.values()].find(
        (a) => a.type === 'segment'
      )
      expect(result.axisOrEdge).toEqual('Edge')
      expect(result.edge).toBeDefined()
      expect(result.edge!.graphSelections[0].codeRef).toEqual(segId!.codeRef)
      expect(result.axis).toBeUndefined()
    })
  })
})
