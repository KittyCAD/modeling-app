import {
  type Artifact,
  assertParse,
  recast,
  type PlaneArtifact,
} from '@src/lang/wasm'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { ArtifactGraph } from '@src/lang/wasm'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import type { KclCommandValue } from '@src/lib/commandTypes'
import {
  addHole,
  addOffsetPlane,
  addShell,
  retrieveFaceSelectionsFromOpArgs,
  retrieveHoleBodyArgs,
  retrieveHoleBottomArgs,
  retrieveHoleTypeArgs,
  retrieveNonDefaultPlaneSelectionFromOpArg,
} from '@src/lang/modifyAst/faces'
import type { DefaultPlaneStr } from '@src/lib/planes'
import type { StdLibCallOp } from '@src/lang/queryAst'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import { getEdgeCutMeta } from '@src/lang/queryAst'
import { expect } from 'vitest'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { KclManager } from '@src/lang/KclSingleton'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import type { ConnectionManager } from '@src/network/connectionManager'
import type RustContext from '@src/lib/rustContext'

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
beforeAll(async () => {
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

describe('faces.test.ts', () => {
  async function getAstAndArtifactGraph(
    code: string,
    instance: ModuleType,
    kclManager: KclManager
  ) {
    const ast = assertParse(code, instance)
    await kclManager.executeAst({ ast })
    const {
      artifactGraph,
      execState: { operations },
      variables,
    } = kclManager
    await new Promise((resolve) => setTimeout(resolve, 100))
    return { ast, artifactGraph, operations, variables }
  }

  function createSelectionFromArtifacts(
    artifacts: Artifact[],
    artifactGraph: ArtifactGraph
  ): Selections {
    const graphSelections = artifacts.flatMap((artifact) => {
      const codeRefs = getCodeRefsByArtifactId(artifact.id, artifactGraph)
      if (!codeRefs || codeRefs.length === 0) {
        return []
      }

      return {
        codeRef: codeRefs[0],
        artifact,
      } as Selection
    })
    return {
      graphSelections,
      otherSelections: [],
    }
  }

  // More complex shell case
  const multiSolids = `size = 100
case = startSketchOn(XY)
  |> startProfile(at = [-size, -size])
  |> line(end = [2 * size, 0])
  |> line(end = [0, 2 * size])
  |> tangentialArc(endAbsolute = [-size, size])
  |> close()
  |> extrude(length = 65)

thing1 = startSketchOn(case, face = END)
  |> circle(center = [-size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)

thing2 = startSketchOn(case, face = END)
  |> circle(center = [size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)`

  const multiSolidsShell = `${multiSolids}
shell001 = shell([thing1, thing2], faces = [END, END], thickness = 5)`

  const cylinder = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 10)
extrude001 = extrude(profile001, length = 10)`

  const box = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10)`

  const boxWithOneTag = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10)`

  const boxWithOneTagAndChamfer = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
  |> chamfer(
       length = 1,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
     )`

  const boxWithOneTagAndChamferAndPlane = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
  |> chamfer(
       length = 1,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
       tag = $seg02,
     )
plane001 = offsetPlane(planeOf(extrude001, face = seg02), offset = 1)`

  const boxWithTwoTags = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10, tag = $seg02)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10)`

  const boxWithTwoTagsAndChamfer = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10, tag = $seg02)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
  |> chamfer(
       length = 1,
       tags = [
         getCommonEdge(faces = [seg01, seg02])
       ],
     )`

  function getCapFromCylinder(artifactGraph: ArtifactGraph) {
    const endFace = [...artifactGraph.values()].find(
      (a) => a.type === 'cap' && a.subType === 'end'
    )
    return createSelectionFromArtifacts([endFace!], artifactGraph)
  }

  function getFacesFromBox(artifactGraph: ArtifactGraph, count: number) {
    const twoWalls = [...artifactGraph.values()]
      .filter((a) => a.type === 'wall')
      .slice(0, count)
    return createSelectionFromArtifacts(twoWalls, artifactGraph)
  }

  describe('Testing addShell', () => {
    it('should add a basic shell call on cylinder end cap', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getCapFromCylinder(artifactGraph)
      const thickness = (await stringToKclExpression(
        '1',
        undefined,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const result = addShell({ ast, artifactGraph, faces, thickness })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(cylinder)
      expect(newCode).toContain(
        `shell001 = shell(extrude001, faces = END, thickness = 1)`
      )
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
    })

    it('should add a shell call on variable-less extrude', async () => {
      // Note: this was code from https://github.com/KittyCAD/modeling-app/issues/7640
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 2358.24])
  |> line(end = [1197.84, -393.04])
  |> line(end = [804.79, -1300.78])
  |> line(end = [505.34, -2498.61])
  |> line(end = [-973.24, -1244.62])
  |> line(endAbsolute = [0, -3434.42])
p = mirror2d([profile001], axis = Y)
extrude(p, length = 1000)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getCapFromCylinder(artifactGraph)
      const thickness = (await stringToKclExpression(
        '1',
        undefined,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const result = addShell({ ast, artifactGraph, faces, thickness })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`${code}
  |> shell(faces = END, thickness = 1)`)
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
    })

    it('should edit a basic shell call on cylinder end cap with new thickness', async () => {
      const code = `${cylinder}
shell001 = shell(extrude001, faces = END, thickness = 1)
`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getCapFromCylinder(artifactGraph)
      const thickness = (await stringToKclExpression(
        '2',
        undefined,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addShell({
        ast,
        artifactGraph,
        faces,
        thickness,
        nodeToEdit,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(cylinder)
      expect(newCode).toContain(
        `shell001 = shell(extrude001, faces = END, thickness = 2)`
      )
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
    })

    it('should add a shell call on box for 2 walls', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getFacesFromBox(artifactGraph, 2)
      const thickness = (await stringToKclExpression(
        '1',
        undefined,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const result = addShell({ ast, artifactGraph, faces, thickness })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`${boxWithTwoTags}
shell001 = shell(extrude001, faces = [seg01, seg02], thickness = 1)`)
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
    })

    it('should edit a shell call on box for 2 walls to a new thickness', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        `${boxWithTwoTags}
shell001 = shell(extrude001, faces = [seg01, seg02], thickness = 1)`,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getFacesFromBox(artifactGraph, 2)
      const thickness = (await stringToKclExpression(
        '2',
        undefined,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addShell({
        ast,
        artifactGraph,
        faces,
        thickness,
        nodeToEdit,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`${boxWithTwoTags}
shell001 = shell(extrude001, faces = [seg01, seg02], thickness = 2)`)
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
    })

    it('should add a shell on two related sweeps end faces', async () => {
      // Code from https://github.com/KittyCAD/modeling-app/blob/21f11c369e1e4bcb6d2514d1150ba5e13138fe32/docs/kcl-std/functions/std-solid-shell.md#L154-L155
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        multiSolids,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const twoCaps = [...artifactGraph.values()]
        .filter((a) => a.type === 'cap' && a.subType === 'end')
        .slice(0, 2)
        .reverse()
      const faces = createSelectionFromArtifacts(twoCaps, artifactGraph)
      const thickness = (await stringToKclExpression(
        '5',
        undefined,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const result = addShell({ ast, artifactGraph, faces, thickness })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(multiSolidsShell)
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
    })
  })

  describe('Testing addHole', () => {
    const simpleHole = `hole001 = hole::hole(
  extrude001,
  face = END,
  cutAt = [0, 0],
  holeBottom =   hole::flat(),
  holeBody =   hole::blind(depth = 5, diameter = 1),
  holeType =   hole::simple(),
)`

    it('should add a simple hole call on cylinder end cap', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const face = getCapFromCylinder(artifactGraph)
      const cutAt = (await stringToKclExpression(
        '[0, 0]',
        true,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const depth = (await stringToKclExpression(
        '5',
        false,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const diameter = (await stringToKclExpression(
        '1',
        false,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const result = addHole({
        ast,
        artifactGraph,
        face,
        cutAt,
        holeBody: 'blind',
        blindDepth: depth,
        blindDiameter: diameter,
        holeType: 'simple',
        holeBottom: 'flat',
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(cylinder)
      expect(newCode).toContain(simpleHole)
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
    })

    // TODO: enable this test once https://github.com/KittyCAD/modeling-app/issues/8616 is closed
    // Currently it resolves to hole(extrude001... instead of hole(hole001
    it.skip('should add a simple hole call on cylinder end cap that has a hole already', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        `${cylinder}
${simpleHole}`,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const face = getCapFromCylinder(artifactGraph)
      const cutAt = (await stringToKclExpression(
        '[3, 3]',
        true,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const depth = (await stringToKclExpression(
        '3',
        false,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const diameter = (await stringToKclExpression(
        '2',
        false,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const result = addHole({
        ast,
        artifactGraph,
        face,
        cutAt,
        holeBody: 'blind',
        blindDepth: depth,
        blindDiameter: diameter,
        holeType: 'simple',
        holeBottom: 'flat',
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `${cylinder}
${simpleHole}
hole002 = hole::hole(
  hole001,
  face = END,
  cutAt = [3, 3],
  holeBottom =   hole::flat(),
  holeBody =   hole::blind(depth = 3, diameter = 2),
  holeType =   hole::simple(),
)`
      )
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
    })

    it('should add a counterbore hole call on cylinder end cap', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const face = getCapFromCylinder(artifactGraph)
      const cutAt = (await stringToKclExpression(
        '[0, 0]',
        true,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const depth = (await stringToKclExpression(
        '5',
        false,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const diameter = (await stringToKclExpression(
        '1',
        false,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const cDepth = (await stringToKclExpression(
        '1',
        false,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const cDiameter = (await stringToKclExpression(
        '2',
        false,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const result = addHole({
        ast,
        artifactGraph,
        face,
        cutAt,
        holeBody: 'blind',
        blindDepth: depth,
        blindDiameter: diameter,
        holeType: 'counterbore',
        counterboreDepth: cDepth,
        counterboreDiameter: cDiameter,
        holeBottom: 'flat',
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(cylinder)
      expect(newCode).toContain(
        `hole001 = hole::hole(
  extrude001,
  face = END,
  cutAt = [0, 0],
  holeBottom =   hole::flat(),
  holeBody =   hole::blind(depth = 5, diameter = 1),
  holeType =   hole::counterbore(depth = 1, diameter = 2),
)`
      )
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
    })

    it('should edit a simple hole call into a countersink hole call on cylinder end cap with drill end', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        `${cylinder}
${simpleHole}`,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const face = getCapFromCylinder(artifactGraph)
      const cutAt = (await stringToKclExpression(
        '[1, 1]',
        true,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const depth = (await stringToKclExpression(
        '6',
        false,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const diameter = (await stringToKclExpression(
        '1.1',
        false,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const dAngle = (await stringToKclExpression(
        '110',
        false,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const cAngle = (await stringToKclExpression(
        '120',
        false,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const cDiameter = (await stringToKclExpression(
        '2',
        false,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const result = addHole({
        ast,
        artifactGraph,
        nodeToEdit,
        face,
        cutAt,
        holeBody: 'blind',
        blindDepth: depth,
        blindDiameter: diameter,
        holeType: 'countersink',
        countersinkAngle: cAngle,
        countersinkDiameter: cDiameter,
        holeBottom: 'drill',
        drillPointAngle: dAngle,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(cylinder)
      expect(newCode).toContain(
        `${cylinder}
hole001 = hole::hole(
  extrude001,
  face = END,
  cutAt = [1, 1],
  holeBottom =   hole::drill(pointAngle = 110),
  holeBody =   hole::blind(depth = 6, diameter = 1.1),
  holeType =   hole::countersink(angle = 120, diameter = 2),
)`
      )
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
    })
  })

  // Hole utils test
  const cylinderForHole = `@settings(experimentalFeatures = allow)
sketch001 = startSketchOn(XZ)
profile001 = circle(sketch001, center = [0, 0], diameter = 10)
extrude001 = extrude(profile001, length = 10)`
  const flatSimpleHole = `${cylinderForHole}
hole001 = hole::hole(
  extrude001,
  face = END,
  cutAt = [0, 0],
  holeBottom =   hole::flat(),
  holeBody =   hole::blind(depth = 5, diameter = 1),
  holeType =   hole::simple(),
)`

  async function getHoleOp(code: string) {
    const { operations } = await getAstAndArtifactGraph(
      code,
      instanceInThisFile,
      kclManagerInThisFile
    )
    const op = operations.find(
      (o) => o.type === 'StdLibCall' && o.name === 'hole::hole'
    )
    if (!op || op.type !== 'StdLibCall' || !op.labeledArgs) {
      throw new Error('Hole operation not found')
    }

    return op
  }

  describe('Testing retrieveHoleBodyArgs', () => {
    it('should return an error on undefined', async () => {
      expect(
        await retrieveHoleBodyArgs(
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )
      ).toBeInstanceOf(Error)
    })

    it('should retrieve the string type, the blind depth and diameter', async () => {
      const op = await getHoleOp(flatSimpleHole)
      const result = await retrieveHoleBodyArgs(
        op.labeledArgs.holeBody,
        instanceInThisFile,
        rustContextInThisFile
      )
      if (err(result)) throw result
      expect(result.holeBody).toEqual('blind')
      expect(result.blindDiameter.valueCalculated).toEqual('1')
      expect(result.blindDepth.valueCalculated).toEqual('5')
    })
  })

  describe('Testing retrieveHoleBottomArgs', () => {
    it('should return an error on undefined', async () => {
      expect(
        await retrieveHoleBottomArgs(
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )
      ).toBeInstanceOf(Error)
    })

    it('should retrieve the string type on flat', async () => {
      const op = await getHoleOp(flatSimpleHole)
      const result = await retrieveHoleBottomArgs(
        op.labeledArgs?.holeBottom,
        instanceInThisFile,
        rustContextInThisFile
      )
      if (err(result)) throw result
      expect(result.holeBottom).toEqual('flat')
      expect(result.drillPointAngle).toBeUndefined()
    })

    it('should retrieve the string type on drilled and angle', async () => {
      const drillHole = `${cylinderForHole}
hole001 = hole::hole(
  extrude001,
  face = END,
  cutAt = [0, 0],
  holeBottom =   hole::drill(pointAngle = 110deg),
  holeBody =   hole::blind(depth = 5, diameter = 1),
  holeType =   hole::simple(),
)`
      const op = await getHoleOp(drillHole)
      const result = await retrieveHoleBottomArgs(
        op.labeledArgs?.holeBottom,
        instanceInThisFile,
        rustContextInThisFile
      )
      if (err(result)) throw result
      expect(result.holeBottom).toEqual('drill')
      expect(result.drillPointAngle?.valueText).toEqual('110deg')
    })
  })

  describe('Testing retrieveHoleTypeArgs', () => {
    it('should return an error on undefined', async () => {
      expect(
        await retrieveHoleTypeArgs(
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )
      ).toBeInstanceOf(Error)
    })

    it('should retrieve the string type on simple', async () => {
      const op = await getHoleOp(flatSimpleHole)
      const result = await retrieveHoleTypeArgs(
        op.labeledArgs?.holeType,
        instanceInThisFile,
        rustContextInThisFile
      )
      if (err(result)) throw result
      expect(result.holeType).toEqual('simple')
      expect(result.countersinkAngle).toBeUndefined()
      expect(result.countersinkDiameter).toBeUndefined()
      expect(result.counterboreDepth).toBeUndefined()
      expect(result.counterboreDiameter).toBeUndefined()
    })

    it('should retrieve the string type on countersink, plus angle and diameter', async () => {
      const countersinkHole = `${cylinderForHole}
hole001 = hole::hole(
  extrude001,
  face = END,
  cutAt = [0, 0],
  holeBottom =   hole::flat(),
  holeBody =   hole::blind(depth = 5, diameter = 1),
  holeType =   hole::countersink(angle = 90deg, diameter = 2),
)`
      const op = await getHoleOp(countersinkHole)
      const result = await retrieveHoleTypeArgs(
        op.labeledArgs?.holeType,
        instanceInThisFile,
        rustContextInThisFile
      )
      if (err(result)) throw result
      expect(result.holeType).toEqual('countersink')
      expect(result.countersinkAngle?.valueText).toEqual('90deg')
      expect(result.countersinkDiameter?.valueText).toEqual('2')
      expect(result.counterboreDepth).toBeUndefined()
      expect(result.counterboreDiameter).toBeUndefined()
    })

    it('should retrieve the string type on counterbore, plus depth and diameter', async () => {
      const countersinkHole = `${cylinderForHole}
hole001 = hole::hole(
  extrude001,
  face = END,
  cutAt = [0, 0],
  holeBottom =   hole::flat(),
  holeBody =   hole::blind(depth = 5, diameter = 1),
  holeType =   hole::counterbore(depth = 1, diameter = 2),
)`
      const op = await getHoleOp(countersinkHole)
      const result = await retrieveHoleTypeArgs(
        op.labeledArgs?.holeType,
        instanceInThisFile,
        rustContextInThisFile
      )
      if (err(result)) throw result
      expect(result.holeType).toEqual('counterbore')
      expect(result.countersinkAngle).toBeUndefined()
      expect(result.countersinkDiameter).toBeUndefined()
      expect(result.counterboreDepth?.valueText).toEqual('1')
      expect(result.counterboreDiameter?.valueText).toEqual('2')
    })
  })

  describe('Testing retrieveFaceSelectionsFromOpArgs', () => {
    it('should find the solid and face of basic shell on cylinder cap', async () => {
      const circleProfileInVar = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
shell001 = shell(extrude001, faces = END, thickness = 0.1)
`
      const { artifactGraph, operations } = await getAstAndArtifactGraph(
        circleProfileInVar,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const op = operations.find(
        (o) => o.type === 'StdLibCall' && o.name === 'shell'
      )
      if (
        !op ||
        op.type !== 'StdLibCall' ||
        !op.unlabeledArg ||
        !op.labeledArgs?.faces
      ) {
        throw new Error('Extrude operation not found')
      }

      const selections = retrieveFaceSelectionsFromOpArgs(
        op.unlabeledArg,
        op.labeledArgs.faces,
        artifactGraph
      )
      if (err(selections)) throw selections

      expect(selections.solids.graphSelections).toHaveLength(1)
      const solid = selections.solids.graphSelections[0]
      if (!solid.artifact) {
        throw new Error('Artifact not found in the selection')
      }
      expect(solid.artifact.type).toEqual('sweep')

      expect(selections.faces.graphSelections).toHaveLength(1)
      const face = selections.faces.graphSelections[0]
      if (!face.artifact || face.artifact.type !== 'cap') {
        throw new Error('Artifact not found in the selection')
      }
      expect(face.artifact.subType).toEqual('end')
      expect(face.artifact.sweepId).toEqual(solid.artifact.id)
    })

    it('should find the sweeps and faces of complex shell', async () => {
      const { artifactGraph, operations } = await getAstAndArtifactGraph(
        multiSolidsShell,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const lastTwoSweeps = [...artifactGraph.values()]
        .filter((a) => a.type === 'sweep')
        .slice(-2)
      const op = operations.find(
        (o) => o.type === 'StdLibCall' && o.name === 'shell'
      )
      if (
        !op ||
        op.type !== 'StdLibCall' ||
        !op.unlabeledArg ||
        !op.labeledArgs?.faces
      ) {
        throw new Error('Extrude operation not found')
      }

      const selections = retrieveFaceSelectionsFromOpArgs(
        op.unlabeledArg,
        op.labeledArgs.faces,
        artifactGraph
      )
      if (err(selections)) throw selections

      expect(selections.solids.graphSelections).toHaveLength(2)
      expect(selections.solids.graphSelections[0].artifact!.id).toEqual(
        lastTwoSweeps[0].id
      )
      expect(selections.solids.graphSelections[1].artifact!.id).toEqual(
        lastTwoSweeps[1].id
      )
      expect(selections.faces.graphSelections).toHaveLength(2)
      expect(selections.faces.graphSelections[0].artifact!.type).toEqual('cap')
      expect(selections.faces.graphSelections[1].artifact!.type).toEqual('cap')
    })
  })

  describe('Testing retrieveNonDefaultPlaneSelectionFromOpArg', () => {
    it('should find an offset plane on an offset plane', async () => {
      const code = `plane001 = offsetPlane(XY, offset = 1)
plane002 = offsetPlane(plane001, offset = 2)`
      const { artifactGraph, operations } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const op = operations.findLast(
        (o) => o.type === 'StdLibCall' && o.name === 'offsetPlane'
      ) as StdLibCallOp
      const selections = retrieveNonDefaultPlaneSelectionFromOpArg(
        op.unlabeledArg!,
        artifactGraph
      )
      if (err(selections)) throw selections
      expect(selections.graphSelections).toHaveLength(1)
      expect(selections.graphSelections[0].artifact!.type).toEqual('plane')
      expect(
        (selections.graphSelections[0].artifact as PlaneArtifact).codeRef
          .pathToNode[1][0]
      ).toEqual(0)
    })

    it('should find an offset plane on a sweep face', async () => {
      const code = `${cylinder}
plane001 = offsetPlane(planeOf(extrude001, face = END), offset = 1)`
      const { artifactGraph, operations } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const op = operations.find(
        (o) => o.type === 'StdLibCall' && o.name === 'offsetPlane'
      ) as StdLibCallOp
      const selections = retrieveNonDefaultPlaneSelectionFromOpArg(
        op.unlabeledArg!,
        artifactGraph
      )
      if (err(selections)) throw selections

      expect(selections.graphSelections).toHaveLength(1)
      expect(selections.graphSelections[0].artifact!.type).toEqual('cap')
      const cap = [...artifactGraph.values()].find(
        (a) => a.type === 'cap' && a.subType === 'end'
      )
      expect(selections.graphSelections[0].artifact!.id).toEqual(cap!.id)
    })

    it('should find an offset plane on a chamfer face', async () => {
      const { artifactGraph, operations } = await getAstAndArtifactGraph(
        boxWithOneTagAndChamferAndPlane,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const op = operations.find(
        (o) => o.type === 'StdLibCall' && o.name === 'offsetPlane'
      ) as StdLibCallOp
      const selections = retrieveNonDefaultPlaneSelectionFromOpArg(
        op.unlabeledArg!,
        artifactGraph
      )
      if (err(selections)) throw selections

      expect(selections.graphSelections).toHaveLength(1)
      expect(selections.graphSelections[0].artifact!.type).toEqual('edgeCut')
    })
  })

  describe('Testing addOffsetPlane', () => {
    it.each<DefaultPlaneStr>(['XY', 'XZ', 'YZ'])(
      'should add a basic offset plane call on default plane %s and then edit it',
      async (name) => {
        const { artifactGraph, ast, variables } = await getAstAndArtifactGraph(
          '',
          instanceInThisFile,
          kclManagerInThisFile
        )
        const offset = (await stringToKclExpression(
          '1',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue
        const id = rustContextInThisFile.getDefaultPlaneId(name)
        if (err(id)) {
          throw id
        }
        const plane: Selections = {
          graphSelections: [],
          otherSelections: [{ name, id }],
        }
        const result = addOffsetPlane({
          ast,
          artifactGraph,
          variables,
          plane,
          offset,
        })
        if (err(result)) {
          throw result
        }

        const newCode = recast(result.modifiedAst, instanceInThisFile)
        expect(newCode).toContain(`plane001 = offsetPlane(${name}, offset = 1)`)
        await enginelessExecutor(
          ast,
          undefined,
          undefined,
          rustContextInThisFile
        )

        const newOffset = (await stringToKclExpression(
          '2',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue
        const nodeToEdit = createPathToNodeForLastVariable(result.modifiedAst)
        const result2 = addOffsetPlane({
          ast: result.modifiedAst,
          artifactGraph,
          variables,
          plane,
          offset: newOffset,
          nodeToEdit,
        })
        if (err(result2)) {
          throw result2
        }
        const newCode2 = recast(result2.modifiedAst, instanceInThisFile)
        expect(newCode2).not.toContain(`offset = 1`)
        expect(newCode2).toContain(
          `plane001 = offsetPlane(${name}, offset = 2)`
        )
        await enginelessExecutor(
          result2.modifiedAst,
          undefined,
          undefined,
          rustContextInThisFile
        )
      }
    )

    it('should add an offset plane call on offset plane and then edit it', async () => {
      const code = `plane001 = offsetPlane(XY, offset = 1)`
      const { artifactGraph, ast, variables } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const offset = (await stringToKclExpression(
        '2',
        undefined,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const artifact = [...artifactGraph.values()].find(
        (a) => a.type === 'plane'
      )
      const plane: Selections = {
        graphSelections: [
          {
            artifact,
            codeRef: artifact!.codeRef,
          },
        ],
        otherSelections: [],
      }
      const result = addOffsetPlane({
        ast,
        artifactGraph,
        variables,
        plane,
        offset,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`${code}
plane002 = offsetPlane(plane001, offset = 2)`)
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)

      const newOffset = (await stringToKclExpression(
        '3',
        undefined,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const nodeToEdit = createPathToNodeForLastVariable(result.modifiedAst)
      const result2 = addOffsetPlane({
        ast: result.modifiedAst,
        artifactGraph,
        variables,
        plane,
        offset: newOffset,
        nodeToEdit,
      })
      if (err(result2)) {
        throw result2
      }
      const newCode2 = recast(result2.modifiedAst, instanceInThisFile)
      expect(newCode2).not.toContain(`offset = 2`)
      expect(newCode2).toContain(`${code}
plane002 = offsetPlane(plane001, offset = 3)`)
      await enginelessExecutor(
        result2.modifiedAst,
        undefined,
        undefined,
        rustContextInThisFile
      )
    })

    it('should add an offset plane call on cylinder end cap and allow edits', async () => {
      const { artifactGraph, ast, variables } = await getAstAndArtifactGraph(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const plane = getCapFromCylinder(artifactGraph)
      const offset = (await stringToKclExpression(
        '2',
        undefined,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const result = addOffsetPlane({
        ast,
        artifactGraph,
        variables,
        plane,
        offset,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`${cylinder}
plane001 = offsetPlane(planeOf(extrude001, face = END), offset = 2)`)
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)

      const newOffset = (await stringToKclExpression(
        '3',
        undefined,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const nodeToEdit = createPathToNodeForLastVariable(result.modifiedAst)
      const result2 = addOffsetPlane({
        ast: result.modifiedAst,
        artifactGraph,
        variables,
        plane,
        offset: newOffset,
        nodeToEdit,
      })
      if (err(result2)) {
        throw result2
      }
      const newCode2 = recast(result2.modifiedAst, instanceInThisFile)
      expect(newCode2).not.toContain(`offset = 2`)
      expect(newCode2).toContain(`${cylinder}
plane001 = offsetPlane(planeOf(extrude001, face = END), offset = 3)`)
      await enginelessExecutor(
        result2.modifiedAst,
        undefined,
        undefined,
        rustContextInThisFile
      )
    })

    it('should add an offset plane call on box wall and allow edits', async () => {
      const { artifactGraph, ast, variables } = await getAstAndArtifactGraph(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const plane = getFacesFromBox(artifactGraph, 1)
      const offset = (await stringToKclExpression(
        '10',
        undefined,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const result = addOffsetPlane({
        ast,
        artifactGraph,
        variables,
        plane,
        offset,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`${boxWithOneTag}
plane001 = offsetPlane(planeOf(extrude001, face = seg01), offset = 10)`)
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)

      const newOffset = (await stringToKclExpression(
        '20',
        undefined,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const nodeToEdit = createPathToNodeForLastVariable(result.modifiedAst)
      const result2 = addOffsetPlane({
        ast: result.modifiedAst,
        artifactGraph,
        variables,
        plane,
        offset: newOffset,
        nodeToEdit,
      })
      if (err(result2)) {
        throw result2
      }
      const newCode2 = recast(result2.modifiedAst, instanceInThisFile)
      expect(newCode2).not.toContain(`offset = 10`)
      expect(newCode2).toContain(`${boxWithOneTag}
plane001 = offsetPlane(planeOf(extrude001, face = seg01), offset = 20)`)
      await enginelessExecutor(
        result2.modifiedAst,
        undefined,
        undefined,
        rustContextInThisFile
      )
    })

    it('should add an offset plane call on chamfer face and allow edits', async () => {
      const { artifactGraph, ast, variables } = await getAstAndArtifactGraph(
        boxWithOneTagAndChamfer,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const chamfer = [...artifactGraph.values()].find(
        (a) => a.type === 'edgeCut'
      )
      const plane = createSelectionFromArtifacts([chamfer!], artifactGraph)
      const offset = (await stringToKclExpression(
        '1',
        undefined,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const result = addOffsetPlane({
        ast,
        artifactGraph,
        variables,
        plane,
        offset,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(boxWithOneTagAndChamferAndPlane)
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)

      const newOffset = (await stringToKclExpression(
        '2',
        undefined,
        instanceInThisFile,
        rustContextInThisFile
      )) as KclCommandValue
      const nodeToEdit = createPathToNodeForLastVariable(result.modifiedAst)
      const result2 = addOffsetPlane({
        ast: result.modifiedAst,
        artifactGraph,
        variables,
        plane,
        offset: newOffset,
        nodeToEdit,
      })
      if (err(result2)) {
        throw result2
      }
      const newCode2 = recast(result2.modifiedAst, instanceInThisFile)
      expect(newCode2).not.toContain(`offset = 1`)
      expect(newCode2).toContain(
        `plane001 = offsetPlane(planeOf(extrude001, face = seg02), offset = 2)`
      )
      await enginelessExecutor(
        result2.modifiedAst,
        undefined,
        undefined,
        rustContextInThisFile
      )
    })
  })

  describe('Testing getEdgeCutMeta', () => {
    it('should find the edge cut meta info on a wall-cap chamfer', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        boxWithOneTagAndChamfer,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const artifact = [...artifactGraph.values()].find(
        (a) => a.type === 'edgeCut'
      )
      const result = getEdgeCutMeta(artifact!, ast, artifactGraph)
      expect(result?.type).toEqual('edgeCut')
      expect(result?.subType).toEqual('opposite')
      expect(result?.tagName).toEqual('seg01')
    })

    it('should find the edge cut meta info on a wall-wall chamfer', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        boxWithTwoTagsAndChamfer,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const artifact = [...artifactGraph.values()].find(
        (a) => a.type === 'edgeCut'
      )
      const result = getEdgeCutMeta(artifact!, ast, artifactGraph)
      expect(result?.type).toEqual('edgeCut')
      expect(result?.subType).toEqual('adjacent')
      expect(result?.tagName).toEqual('seg01')
    })
  })
})
