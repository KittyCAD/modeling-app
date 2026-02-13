import { assertParse, type PathToNode, recast } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { topLevelRange } from '@src/lang/util'
import { isOverlap } from '@src/lib/utils'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import type { KclManager } from '@src/lang/KclManager'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { Selection } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import {
  addChamfer,
  addFillet,
  deleteEdgeTreatment,
  EdgeTreatmentType,
} from '@src/lang/modifyAst/edges'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import type { KclCommandValue } from '@src/lib/commandTypes'
import {
  enginelessExecutor,
  createSelectionFromArtifacts,
  getAstAndArtifactGraph,
} from '@src/lib/testHelpers'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { afterAll, expect, beforeEach, describe, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
let kclManagerInThisFile: KclManager = null!
let rustContextInThisFile: RustContext = null!
let engineCommandManagerInThisFile: ConnectionManager = null!

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
  rustContextInThisFile = rustContext
  engineCommandManagerInThisFile = engineCommandManager
})
afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
})

describe('edges.spec.ts', () => {
  const extrudedTriangle = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5)`
  const extrudedTriangleWithFillet = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
fillet001 = fillet(extrude001, tags = getCommonEdge(faces = [seg01, capEnd001]), radius = 1)`
  const extrudedTriangleWithChamfer = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
chamfer001 = chamfer(extrude001, tags = getCommonEdge(faces = [seg01, capEnd001]), length = 1)`
  const twoExtrudedTriangles = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5)
  |> yLine(length = 5)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5)

sketch002 = startSketchOn(XY)
profile002 = startProfile(sketch002, at = [10, 0])
  |> xLine(length = 5)
  |> yLine(length = 5)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(profile002, length = 5)`
  const revolvedCShapeWithRectangularProfile = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 1])
  |> yLine(length = 3)
  |> xLine(length = 4)
  |> yLine(length = -3)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(profile001, angle = 270deg, axis = X)`

  describe('Testing addFillet', () => {
    it('should add a basic fillet call on sweepEdge', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(extrudedTriangleWithFillet)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a basic fillet call on a sweepEdge and a segment', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweepEdge = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge'
      )!
      const segment = [...artifactGraph.values()].find(
        (a) => a.type === 'segment'
      )!
      const selection = createSelectionFromArtifacts(
        [sweepEdge, segment],
        artifactGraph
      )
      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(
  profile001,
  length = 5,
  tagEnd = $capEnd001,
  tagStart = $capStart001,
)
fillet001 = fillet(
  extrude001,
  tags = [
    getCommonEdge(faces = [seg01, capEnd001]),
    getCommonEdge(faces = [seg01, capStart001])
  ],
  radius = 1,
)`)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a basic fillet call with tag on sweepEdge', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        tag: 'myTag',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
fillet001 = fillet(
  extrude001,
  tags =   getCommonEdge(faces = [seg01, capEnd001]),
  radius = 1,
  tag = $myTag,
)`
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should edit a basic fillet call on sweepEdge', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangleWithFillet,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
      const nodeToEdit = createPathToNodeForLastVariable(ast, false)
      const radius = (await stringToKclExpression(
        '1.1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        extrudedTriangleWithFillet.replace('radius = 1', 'radius = 1.1')
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should edit a piped fillet call on sweepEdge', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-18.43, -11.95])
  |> angledLine(angle = 0, length = 20, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90, length = 20)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg01)
  |> close()
extrude001 = extrude(profile001, length = 20, tagEnd = $capEnd001)
  |> fillet(tags = getCommonEdge(faces = [rectangleSegmentA001, capEnd001]), radius = 2.5)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [2, 'index'],
        ['declaration', 'VariableDeclaration'],
        ['init', ''],
        ['body', 'PipeExpression'],
        [1, 'index'],
      ]
      const radius = (await stringToKclExpression(
        '2',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(code.replace('radius = 2.5', 'radius = 2'))
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add fillet calls on two bodies with one edge selected on each', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        twoExtrudedTriangles,
        instanceInThisFile,
        kclManagerInThisFile
      )

      // Get all sweep artifacts (bodies)
      const sweeps = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweep'
      )
      expect(sweeps.length).toBe(2)

      // Get sweep edges from each body
      const sweepEdgesBody1 = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweepEdge' && a.sweepId === sweeps[0].id
      )
      const sweepEdgesBody2 = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweepEdge' && a.sweepId === sweeps[1].id
      )

      expect(sweepEdgesBody1.length).toBeGreaterThan(0)
      expect(sweepEdgesBody2.length).toBeGreaterThan(0)

      const selection = createSelectionFromArtifacts(
        [sweepEdgesBody1[0], sweepEdgesBody2[0]],
        artifactGraph
      )

      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue

      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Should have created two separate fillet calls, one for each body
      expect(newCode).toContain('fillet001 = fillet(extrude001')
      expect(newCode).toContain('fillet002 = fillet(extrude002')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a fillet call to revolve', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        revolvedCShapeWithRectangularProfile,
        instanceInThisFile,
        kclManagerInThisFile
      )

      // Find a sweepEdge from the revolve
      const sweepEdge = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge'
      )!

      const selection = createSelectionFromArtifacts([sweepEdge], artifactGraph)

      const radius = (await stringToKclExpression(
        '0.5',
        rustContextInThisFile
      )) as KclCommandValue

      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        wasmInstance: instanceInThisFile,
      })

      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)

      // Verify the fillet was added
      expect(newCode).toContain('fillet001 = fillet(revolve001')
      expect(newCode).toContain('radius = 0.5')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addChamfer', () => {
    it('should add a basic chamfer call on sweepEdge', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
      const length = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(extrudedTriangleWithChamfer)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a basic chamfer call on a sweepEdge and a segment', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweepEdge = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge'
      )!
      const segment = [...artifactGraph.values()].find(
        (a) => a.type === 'segment'
      )!
      const selection = createSelectionFromArtifacts(
        [sweepEdge, segment],
        artifactGraph
      )
      const length = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(
  profile001,
  length = 5,
  tagEnd = $capEnd001,
  tagStart = $capStart001,
)
chamfer001 = chamfer(
  extrude001,
  tags = [
    getCommonEdge(faces = [seg01, capEnd001]),
    getCommonEdge(faces = [seg01, capStart001])
  ],
  length = 1,
)`)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a chamfer call on sweepEdge with two lengths', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
      const length = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const secondLength = (await stringToKclExpression(
        '1.1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        secondLength,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
chamfer001 = chamfer(
  extrude001,
  tags =   getCommonEdge(faces = [seg01, capEnd001]),
  length = 1,
  secondLength = 1.1,
)`)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a chamfer call on sweepEdge with one length and one angle, and a tag', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
      const length = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const angle = (await stringToKclExpression(
        '46deg',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        angle,
        tag: 'myChamferTag',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
chamfer001 = chamfer(
  extrude001,
  tags =   getCommonEdge(faces = [seg01, capEnd001]),
  length = 1,
  angle = 46deg,
  tag = $myChamferTag,
)`)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should edit a basic chamfer call on sweepEdge', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangleWithChamfer,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
      const nodeToEdit = createPathToNodeForLastVariable(ast, false)
      const length = (await stringToKclExpression(
        '1.1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        extrudedTriangleWithChamfer.replace('length = 1', 'length = 1.1')
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add chamfer calls on two bodies with one edge selected on each', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        twoExtrudedTriangles,
        instanceInThisFile,
        kclManagerInThisFile
      )

      // Get all sweep artifacts (bodies)
      const sweeps = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweep'
      )
      expect(sweeps.length).toBe(2)

      // Get sweep edges from each body
      const sweepEdgesBody1 = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweepEdge' && a.sweepId === sweeps[0].id
      )
      const sweepEdgesBody2 = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweepEdge' && a.sweepId === sweeps[1].id
      )

      expect(sweepEdgesBody1.length).toBeGreaterThan(0)
      expect(sweepEdgesBody2.length).toBeGreaterThan(0)

      const selection = createSelectionFromArtifacts(
        [sweepEdgesBody1[0], sweepEdgesBody2[0]],
        artifactGraph
      )

      const length = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue

      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Should have created two separate chamfer calls, one for each body
      expect(newCode).toContain('chamfer001 = chamfer(extrude001')
      expect(newCode).toContain('chamfer002 = chamfer(extrude002')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a chamfer call to revolve', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        revolvedCShapeWithRectangularProfile,
        instanceInThisFile,
        kclManagerInThisFile
      )

      // Find a sweepEdge from the revolve
      const sweepEdge = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge'
      )!

      const selection = createSelectionFromArtifacts([sweepEdge], artifactGraph)

      const length = (await stringToKclExpression(
        '0.5',
        rustContextInThisFile
      )) as KclCommandValue

      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        wasmInstance: instanceInThisFile,
      })

      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)

      // Verify the chamfer was added
      expect(newCode).toContain('chamfer001 = chamfer(revolve001')
      expect(newCode).toContain('length = 0.5')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  const runDeleteEdgeTreatmentTest = async (
    code: string,
    edgeTreatmentSnippet: string,
    expectedCode: string,
    instance: ModuleType,
    kclManager: KclManager
  ) => {
    // parse ast
    const ast = assertParse(code, instance)

    // update artifact graph
    await kclManager.executeAst({ ast })
    const artifactGraph = kclManager.artifactGraph

    expect(kclManager.errors).toEqual([])

    // define snippet range
    const edgeTreatmentRange = topLevelRange(
      code.indexOf(edgeTreatmentSnippet),
      code.indexOf(edgeTreatmentSnippet) + edgeTreatmentSnippet.length
    )

    // find artifact
    const maybeArtifact = [...artifactGraph].find(([, artifact]) => {
      if (!('codeRef' in artifact)) return false
      return isOverlap(artifact.codeRef.range, edgeTreatmentRange)
    })

    // build selection
    const selection: Selection = {
      codeRef: codeRefFromRange(edgeTreatmentRange, ast),
      artifact: maybeArtifact ? maybeArtifact[1] : undefined,
    }

    // delete edge treatment
    const result = await deleteEdgeTreatment(ast, selection, instanceInThisFile)
    if (err(result)) {
      expect(result).toContain(expectedCode)
      return result
    }

    // recast and check
    const newCode = recast(result, instance)
    expect(newCode).toContain(expectedCode)
  }
  // Iterate tests over all edge treatment types
  Object.values(EdgeTreatmentType).forEach(
    (edgeTreatmentType: EdgeTreatmentType) => {
      // create parameters based on the edge treatment type
      let parameterName: string
      if (edgeTreatmentType === EdgeTreatmentType.Fillet) {
        parameterName = 'radius'
      } else if (edgeTreatmentType === EdgeTreatmentType.Chamfer) {
        parameterName = 'length'
      } else {
        // Handle future edge treatments
        return new Error(
          `Unsupported edge treatment type: ${edgeTreatmentType}`
        )
      }

      describe(`Testing deleteEdgeTreatment with ${edgeTreatmentType}s`, () => {
        // simple cases
        it(`should delete a piped ${edgeTreatmentType} from a single segment`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])`
          const edgeTreatmentSnippet = `${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        it(`should delete a standalone assigned ${edgeTreatmentType} from a single segment`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
${edgeTreatmentType}001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [seg01])`
          const edgeTreatmentSnippet = `${edgeTreatmentType}001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [seg01])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        it(`should delete a standalone ${edgeTreatmentType} without assignment from a single segment`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
${edgeTreatmentType}(extrude001, ${parameterName} = 5, tags = [seg01])`
          const edgeTreatmentSnippet = `${edgeTreatmentType}(extrude001, ${parameterName} = 5, tags = [seg01])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        // getOppositeEdge and getNextAdjacentEdge cases
        it(`should delete a piped ${edgeTreatmentType} tagged with getOppositeEdge`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [getOppositeEdge(seg01)])`
          const edgeTreatmentSnippet = `fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [getOppositeEdge(seg01)])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        it(`should delete a non-piped ${edgeTreatmentType} tagged with getNextAdjacentEdge`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [getNextAdjacentEdge(seg01)])`
          const edgeTreatmentSnippet = `fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [getNextAdjacentEdge(seg01)])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        // cases with several edge treatments
        it(`should delete a piped ${edgeTreatmentType} from a body with multiple treatments`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])
  |> fillet(radius = 5, tags = [getOppositeEdge(seg02)])
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])
chamfer001 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])`
          const edgeTreatmentSnippet = `${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
  |> fillet(radius = 5, tags = [getOppositeEdge(seg02)])
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])
chamfer001 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        it(`should delete a non-piped ${edgeTreatmentType} from a body with multiple treatments`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])
  |> fillet( radius = 5, tags = [getOppositeEdge(seg02)] )
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])
chamfer001 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])`
          const edgeTreatmentSnippet = `fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])
  |> fillet(radius = 5, tags = [getOppositeEdge(seg02)])
chamfer001 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        // Revolve-specific test
        it(`should delete a ${edgeTreatmentType} from a revolved C-shape with rectangular profile`, async () => {
          const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 1])
  |> yLine(length = 3)
  |> xLine(length = 4, tag = $seg01)
  |> yLine(length = -3)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(
  profile001,
  angle = 270deg,
  axis = X,
  tagStart = $capStart001,
)
${edgeTreatmentType}001 = ${edgeTreatmentType}(revolve001, tags = getCommonEdge(faces = [seg01, capStart001]), ${parameterName} = 1)`
          const edgeTreatmentSnippet = `${edgeTreatmentType}001 = ${edgeTreatmentType}(revolve001, tags = getCommonEdge(faces = [seg01, capStart001]), ${parameterName} = 1)`
          const expectedCode = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 1])
  |> yLine(length = 3)
  |> xLine(length = 4, tag = $seg01)
  |> yLine(length = -3)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(
  profile001,
  angle = 270deg,
  axis = X,
  tagStart = $capStart001,
)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        // Test deletion of geometrically impossible edge treatment
        it(`should delete a ${edgeTreatmentType} with geometrically impossible value from a revolved shape`, async () => {
          const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 1])
  |> yLine(length = 3)
  |> xLine(length = 4)
  |> yLine(length = -3, tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(
  profile001,
  angle = 270deg,
  axis = X,
  tagStart = $capStart001,
)
${edgeTreatmentType}001 = ${edgeTreatmentType}(revolve001, tags = getCommonEdge(faces = [seg01, capStart001]), ${parameterName} = 5)`
          const edgeTreatmentSnippet = `${edgeTreatmentType}001 = ${edgeTreatmentType}(revolve001, tags = getCommonEdge(faces = [seg01, capStart001]), ${parameterName} = 5)`
          const expectedCode = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 1])
  |> yLine(length = 3)
  |> xLine(length = 4)
  |> yLine(length = -3, tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(
  profile001,
  angle = 270deg,
  axis = X,
  tagStart = $capStart001,
)`

          // This test case is special because the fillet/chamfer is geometrically impossible
          // (value too large), so we can't execute the AST. Instead, we test that the deletion
          // works purely on the AST level without needing execution artifacts.
          const ast = assertParse(code, instanceInThisFile)

          // define snippet range
          const edgeTreatmentRange = topLevelRange(
            code.indexOf(edgeTreatmentSnippet),
            code.indexOf(edgeTreatmentSnippet) + edgeTreatmentSnippet.length
          )

          const edgeTreatmentCodeRef = codeRefFromRange(edgeTreatmentRange, ast)

          // build selection with a mock edgeCut artifact
          const selection: Selection = {
            codeRef: edgeTreatmentCodeRef,
            artifact: {
              type: 'edgeCut',
              id: 'mock-edge-cut-id',
              subType: edgeTreatmentType,
              consumedEdgeId: 'mock-consumed-edge-id',
              edgeIds: [],
              codeRef: {
                range: edgeTreatmentCodeRef.range,
                pathToNode: edgeTreatmentCodeRef.pathToNode,
                nodePath: { steps: [] },
              },
            },
          }

          // delete edge treatment
          const result = await deleteEdgeTreatment(
            ast,
            selection,
            instanceInThisFile
          )
          if (err(result)) {
            throw result
          }

          // recast and check
          const newCode = recast(result, instanceInThisFile)
          expect(newCode).toContain(expectedCode)
        }, 10_000)
        // Test deletion of geometrically impossible edge treatment (piped case)
        it(`should delete a piped ${edgeTreatmentType} with geometrically impossible value from a revolved shape`, async () => {
          const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 1])
  |> yLine(length = 3)
  |> xLine(length = 4)
  |> yLine(length = -3, tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(
  profile001,
  angle = 270deg,
  axis = X,
  tagStart = $capStart001,
)
  |> ${edgeTreatmentType}(tags = getCommonEdge(faces = [seg01, capStart001]), ${parameterName} = 5)`
          const edgeTreatmentSnippet = `${edgeTreatmentType}(tags = getCommonEdge(faces = [seg01, capStart001]), ${parameterName} = 5)`
          const expectedCode = `yLine(length = -3, tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(`

          // This test case is special because the fillet/chamfer is geometrically impossible
          // (value too large), so we can't execute the AST. Instead, we test that the deletion
          // works purely on the AST level without needing execution artifacts.
          const ast = assertParse(code, instanceInThisFile)

          // define snippet range
          const edgeTreatmentRange = topLevelRange(
            code.indexOf(edgeTreatmentSnippet),
            code.indexOf(edgeTreatmentSnippet) + edgeTreatmentSnippet.length
          )

          const edgeTreatmentCodeRef = codeRefFromRange(edgeTreatmentRange, ast)

          // build selection with a mock edgeCut artifact
          const selection: Selection = {
            codeRef: edgeTreatmentCodeRef,
            artifact: {
              type: 'edgeCut',
              id: 'mock-edge-cut-id',
              subType: edgeTreatmentType,
              consumedEdgeId: 'mock-consumed-edge-id',
              edgeIds: [],
              codeRef: {
                range: edgeTreatmentCodeRef.range,
                pathToNode: edgeTreatmentCodeRef.pathToNode,
                nodePath: { steps: [] },
              },
            },
          }

          // delete edge treatment
          const result = await deleteEdgeTreatment(
            ast,
            selection,
            instanceInThisFile
          )
          if (err(result)) {
            throw result
          }

          // recast and check
          const newCode = recast(result, instanceInThisFile)
          expect(newCode).toContain(expectedCode)
        }, 10_000)
      })
    }
  )
})
