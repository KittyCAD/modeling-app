import {
  type Artifact,
  assertParse,
  type CodeRef,
  type Program,
  recast,
  type Name,
  type CallExpressionKw,
} from '@src/lang/wasm'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err, reportRejection } from '@src/lib/trap'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import {
  engineCommandManager,
  kclManager,
  codeManager,
} from '@src/lib/singletons'
import type { ArtifactGraph } from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'
import env from '@src/env'
import {
  addExtrude,
  addLoft,
  addRevolve,
  addSweep,
  getAxisExpressionAndIndex,
  retrieveAxisOrEdgeSelectionsFromOpArg,
} from '@src/lang/modifyAst/sweeps'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import {
  addPatternCircular3D,
  addPatternLinear3D,
} from '@src/lang/modifyAst/pattern3D'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { addHelix } from '@src/lang/modifyAst/geometry'
import {
  createLiteral,
  createIdentifier,
  createVariableDeclaration,
} from '@src/lang/create'
import { getNodeFromPath } from '@src/lang/queryAst'
import { expect } from 'vitest'
import { modelingMachine } from '@src/machines/modelingMachine'
import { createActor } from 'xstate'
import { vi } from 'vitest'
import { getConstraintInfoKw } from '@src/lang/std/sketch'
import { ARG_END_ABSOLUTE, ARG_INTERIOR_ABSOLUTE } from '@src/lang/constants'
import { removeSingleConstraintInfo } from '@src/lang/modifyAst'
import { modelingMachineDefaultContext } from '@src/machines/modelingSharedContext'
import {
  removeSingleConstraint,
  transformAstSketchLines,
} from '@src/lang/std/sketchcombos'

// Unfortunately, we need the real engine here it seems to get sweep faces populated
beforeAll(async () => {
  await initPromise
  await new Promise((resolve) => {
    engineCommandManager
      .start({
        token: env().VITE_KITTYCAD_API_TOKEN || '',
        width: 256,
        height: 256,
        setStreamIsReady: () => {
          console.log('no op for a unit test')
        },
        callbackOnUnitTestingConnection: () => {
          resolve(true)
        },
      })
      .catch(reportRejection)
  })
}, 30_000)

afterAll(() => {
  engineCommandManager.tearDown()
})

// TODO: two different methods for the same thing. Why?
async function ENGLINELESS_getAstAndArtifactGraph(code: string) {
  const ast = assertParse(code)
  if (err(ast)) throw ast

  const { artifactGraph } = await enginelessExecutor(ast)
  return { ast, artifactGraph }
}

const executeCode = async (code: string) => {
  const ast = assertParse(code)
  await kclManager.executeAst({ ast })
  const artifactGraph = kclManager.artifactGraph
  await new Promise((resolve) => setTimeout(resolve, 100))
  return { ast, artifactGraph }
}

async function ENGINELESS_getAstAndSketchSelections(code: string) {
  const { ast, artifactGraph } = await ENGLINELESS_getAstAndArtifactGraph(code)
  const artifacts = [...artifactGraph.values()].filter((a) => a.type === 'path')
  if (artifacts.length === 0) {
    throw new Error('Artifact not found in the graph')
  }
  return { artifactGraph, ast, sketches }
}

async function runNewAstAndCheckForSweep(ast: Node<Program>) {
  const { artifactGraph } = await enginelessExecutor(ast)
  const sweepArtifact = artifactGraph.values().find((a) => a.type === 'sweep')
  expect(sweepArtifact).toBeDefined()
}
const createSelectionWithFirstMatchingArtifact = async (
  artifactGraph: ArtifactGraph,
  artifactType: string,
  subType?: string
) => {
  // Check if any artifacts of this type exist at all
  const allArtifactsOfType = [...artifactGraph].filter(([, artifact]) => {
    if (artifact.type !== artifactType) return false
    // If subType is specified, check for that too
    if (subType && 'subType' in artifact && artifact.subType !== subType)
      return false
    return true
  })

  // get first artifact of this type
  const firstArtifactsOfType = allArtifactsOfType[0][1]
  if (!firstArtifactsOfType) {
    return new Error(`No artifacts of type ${artifactType} found`)
  }

  // get codeRef
  let codeRef = null

  if (firstArtifactsOfType.type === 'segment') {
    codeRef = firstArtifactsOfType.codeRef
  } else if (firstArtifactsOfType.type === 'sweepEdge') {
    // find the parent segment
    const segment = [...artifactGraph].filter(([, artifact]) => {
      if (artifact.id !== firstArtifactsOfType.segId) return false
      return true
    })
    if ('codeRef' in segment[0][1]) {
      codeRef = segment[0][1].codeRef
    }
  }

  if (!codeRef) {
    return new Error('No codeRef found for artifact')
  }

  // Create selection from found artifact
  const selection: Selection = {
    artifact: firstArtifactsOfType,
    codeRef: codeRef,
  }

  return { selection }
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
      const { ast, sketches } =
        await getAstAndSketchSelections(circleProfileCode)
      const length = await getKclCommandValue('1')
      const result = addExtrude({ ast, sketches, length })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(`extrude001 = extrude(profile001, length = 1)`)
      await runNewAstAndCheckForSweep(result.modifiedAst)
    })

    it('should add a basic multi-profile extrude call', async () => {
      const { ast, sketches } = await getAstAndSketchSelections(
        circleAndRectProfilesCode
      )
      const length = await getKclCommandValue('1')
      const result = addExtrude({ ast, sketches, length })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude([profile001, profile002], length = 1)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst)
    })

    it('should add an extrude call with symmetric true', async () => {
      const { ast, sketches } =
        await getAstAndSketchSelections(circleProfileCode)
      const length = await getKclCommandValue('1')
      const result = addExtrude({ ast, sketches, length, symmetric: true })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude(profile001, length = 1, symmetric = true)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst)
    })

    it('should add an extrude call with bidirectional length and twist angle', async () => {
      const { ast, sketches } =
        await getAstAndSketchSelections(circleProfileCode)
      const length = await getKclCommandValue('10')
      const bidirectionalLength = await getKclCommandValue('20')
      const twistAngle = await getKclCommandValue('30')
      const result = addExtrude({
        ast,
        sketches,
        length,
        bidirectionalLength,
        twistAngle,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
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
      const { ast, sketches } = await getAstAndSketchSelections(extrudeCode)
      const length = await getKclCommandValue('2')
      const symmetric = false
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addExtrude({
        ast,
        sketches,
        length,
        symmetric,
        nodeToEdit,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(`${circleProfileCode}
extrude001 = extrude(profile001, length = 2)`)
      await runNewAstAndCheckForSweep(result.modifiedAst)
    })

    it('should add an extrude call with method NEW', async () => {
      const { ast, sketches } =
        await getAstAndSketchSelections(circleProfileCode)
      const length = await getKclCommandValue('1')
      const result = addExtrude({ ast, sketches, length, method: 'NEW' })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude(profile001, length = 1, method = NEW)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst)
    })
  })

  describe('Testing addSweep', () => {
    const circleAndLineCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
sketch002 = startSketchOn(XZ)
profile002 = startProfile(sketch002, at = [0, 0])
  |> xLine(length = -5)
  |> tangentialArc(endAbsolute = [-20, 5])`

    async function getAstAndSketchesForSweep(code: string) {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
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
      const { ast, sketches, path } =
        await getAstAndSketchesForSweep(circleAndLineCode)
      const result = addSweep({ ast, sketches, path })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleAndLineCode)
      expect(newCode).toContain(
        `sweep001 = sweep(profile001, path = profile002)`
      )
    })

    it('should add a sweep call with sectional true and relativeTo setting', async () => {
      const { ast, sketches, path } =
        await getAstAndSketchesForSweep(circleAndLineCode)
      const sectional = true
      const relativeTo = 'sketchPlane'
      const result = addSweep({ ast, sketches, path, sectional, relativeTo })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleAndLineCode)
      expect(newCode).toContain(`sweep001 = sweep(
  profile001,
  path = profile002,
  sectional = true,
  relativeTo = 'sketchPlane',
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
        circleAndLineCodeWithSweep
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
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleAndLineCode)
      expect(newCode).toContain(
        `sweep001 = sweep(profile001, path = profile002, relativeTo = 'trajectoryCurve')`
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
        circleAndLineAndRectProfilesCode
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
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
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
      const { ast, sketches } = await getAstAndSketchSelections(twoCirclesCode)
      expect(sketches.graphSelections).toHaveLength(2)
      const result = addLoft({
        ast,
        sketches,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(twoCirclesCode)
      expect(newCode).toContain(`loft001 = loft([profile001, profile002]`)
      // Don't think we can find the artifact here for loft?
    })

    it('should edit a loft call with vDegree', async () => {
      const twoCirclesCodeWithLoft = `${twoCirclesCode}
loft001 = loft([profile001, profile002])`
      const { ast, sketches } = await getAstAndSketchSelections(
        twoCirclesCodeWithLoft
      )
      expect(sketches.graphSelections).toHaveLength(2)
      const vDegree = await getKclCommandValue('3')
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addLoft({
        ast,
        sketches,
        vDegree,
        nodeToEdit,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
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
      const { ast, sketches } = await getAstAndSketchSelections(circleCode)
      expect(sketches.graphSelections).toHaveLength(1)
      const angle = await getKclCommandValue('10')
      const axis = 'X'
      const result = addRevolve({ ast, sketches, angle, axis })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleCode)
      expect(newCode).toContain(
        `revolve001 = revolve(profile001, angle = 10, axis = X)`
      )
    })

    it('should add basic revolve call with symmetric true', async () => {
      const { ast, sketches } = await getAstAndSketchSelections(circleCode)
      expect(sketches.graphSelections).toHaveLength(1)
      const angle = await getKclCommandValue('10')
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
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
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
        circleAndRectProfilesCode
      )
      const angle = await getKclCommandValue('10')
      const axis = 'X'
      const result = addRevolve({
        ast,
        sketches,
        angle,
        axis,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `revolve001 = revolve([profile001, profile002], angle = 10, axis = X)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst)
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
      const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
      const artifacts = [...artifactGraph.values()]
      const circleArtifact = artifacts.findLast((a) => a.type === 'path')
      if (!circleArtifact) throw new Error('Circle artifact not found in graph')
      const sketches = createSelectionFromPathArtifact([circleArtifact])
      const edgeArtifact = artifacts.find((a) => a.type === 'segment')
      if (!edgeArtifact) throw new Error('Edge artifact not found in graph')
      const edge = createSelectionFromPathArtifact([edgeArtifact])
      const angle = await getKclCommandValue('20')
      const result = addRevolve({ ast, sketches, angle, edge })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
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
      const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
      const artifacts = [...artifactGraph.values()]
      const circleArtifact = artifacts.findLast((a) => a.type === 'path')
      if (!circleArtifact) throw new Error('Circle artifact not found in graph')
      const sketches = createSelectionFromPathArtifact([circleArtifact])
      const edgeArtifact = artifacts.findLast((a) => a.type === 'segment')
      if (!edgeArtifact) throw new Error('Edge artifact not found in graph')
      const edge = createSelectionFromPathArtifact([edgeArtifact])
      const angle = await getKclCommandValue('360')
      const result = addRevolve({ ast, sketches, angle, edge })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
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
      const { ast, sketches } = await ENGINELESS_getAstAndSketchSelections(code)
      expect(sketches.graphSelections).toHaveLength(1)
      const angle = await getKclCommandValue('20')
      const bidirectionalAngle = await getKclCommandValue('30')
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
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
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
      (axis) => {
        const ast = assertParse('')
        const result = getAxisExpressionAndIndex(axis, undefined, ast)
        if (err(result)) throw result
        expect(result.generatedAxis.type).toEqual('Name')
        expect((result.generatedAxis as Node<Name>).name.name).toEqual(axis)
      }
    )

    it('should return a generated axis pointing to the selected segment', async () => {
      const { ast, artifactGraph } =
        await getAstAndArtifactGraph(`sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 1)`)
      const edgeArtifact = [...artifactGraph.values()].find(
        (a) => a.type === 'segment'
      )
      const edge: Selections = createSelectionFromPathArtifact([edgeArtifact!])
      const result = getAxisExpressionAndIndex(undefined, edge, ast)
      if (err(result)) throw result
      expect(result.generatedAxis.type).toEqual('Name')
      expect((result.generatedAxis as Node<Name>).name.name).toEqual('seg01')
      expect(recast(ast)).toContain(`xLine(length = 1, tag = $seg01)`)
    })

    it('should error if nothing is provided', async () => {
      const result = getAxisExpressionAndIndex(
        undefined,
        undefined,
        assertParse('')
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
        const ast = assertParse(helixCode)
        const { artifactGraph, operations } = await enginelessExecutor(ast)
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
      const ast = assertParse(helixCode)
      const { artifactGraph, operations } = await enginelessExecutor(ast)
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

describe('pattern3D.test.ts', () => {
  async function getAstAndArtifactGraph(code: string) {
    const ast = assertParse(code)
    if (err(ast)) throw ast

    const { artifactGraph } = await enginelessExecutor(ast)
    return { ast, artifactGraph }
  }

  function createSelectionFromPathArtifact(
    artifacts: (Artifact & { codeRef: CodeRef })[]
  ): Selections {
    const graphSelections = artifacts.map(
      (artifact) =>
        ({
          codeRef: artifact.codeRef,
          artifact,
        }) as Selection
    )
    return {
      graphSelections,
      otherSelections: [],
    }
  }

  async function getAstAndSolidSelections(code: string) {
    const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
    // Filter for sweep artifacts that represent 3D solids
    const artifacts = [...artifactGraph.values()].filter(
      (a) => a.type === 'sweep'
    )
    if (artifacts.length === 0) {
      throw new Error('Sweep artifact not found in the graph')
    }
    const selections = createSelectionFromPathArtifact(artifacts)
    return { ast, selections, artifactGraph }
  }

  async function getKclCommandValue(value: string) {
    const result = await stringToKclExpression(value)
    if (err(result) || 'errors' in result) {
      throw new Error('Failed to create KCL expression')
    }
    return result
  }

  describe('Testing addPatternCircular3D', () => {
    it('should add patternCircular3d with named axis', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('11'),
        axis: 'X',
        center: await getKclCommandValue('[10, -20, 0]'),
        arcDegrees: await getKclCommandValue('360'),
        rotateDuplicates: true,
        useOriginal: false,
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 11')
      expect(newCode).toContain('axis = X')
      expect(newCode).toContain('center = [10, -20, 0]')
      expect(newCode).toContain('arcDegrees = 360')
      expect(newCode).toContain('rotateDuplicates = true')
      expect(newCode).toContain('useOriginal = false')
    })

    it('should add patternCircular3d with array axis', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('11'),
        axis: await getKclCommandValue('[1, -1, 0]'),
        center: await getKclCommandValue('[10, -20, 0]'),
        arcDegrees: await getKclCommandValue('360'),
        rotateDuplicates: true,
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 11')
      expect(newCode).toContain('axis = [1, -1, 0]')
      expect(newCode).toContain('center = [10, -20, 0]')
      expect(newCode).toContain('arcDegrees = 360')
      expect(newCode).toContain('rotateDuplicates = true')
    })

    it('should add patternCircular3d with minimal required parameters', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('5'),
        axis: 'Z',
        center: await getKclCommandValue('[0, 0, 0]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 5')
      expect(newCode).toContain('axis = Z')
      expect(newCode).toContain('center = [0, 0, 0]')
      expect(newCode).not.toContain('arcDegrees')
      expect(newCode).not.toContain('rotateDuplicates')
      expect(newCode).not.toContain('useOriginal')
    })

    it('should handle all optional parameters', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('6'),
        axis: 'Y',
        center: await getKclCommandValue('[0, 0, 0]'),
        arcDegrees: await getKclCommandValue('180'),
        rotateDuplicates: true,
        useOriginal: false,
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 6')
      expect(newCode).toContain('axis = Y')
      expect(newCode).toContain('center = [0, 0, 0]')
      expect(newCode).toContain('arcDegrees = 180')
      expect(newCode).toContain('rotateDuplicates = true')
      expect(newCode).toContain('useOriginal = false')
    })

    it('should handle variable references for parameters', async () => {
      const code = `
myInstances = 8
myAxis = [0, 0, 1]
myCenter = [5, 5, 0]

exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('myInstances'),
        axis: await getKclCommandValue('myAxis'),
        center: await getKclCommandValue('myCenter'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = myInstances')
      expect(newCode).toContain('axis = myAxis')
      expect(newCode).toContain('center = myCenter')
    })

    it('should handle decimal values for all parameters', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('2.5'),
        axis: await getKclCommandValue('[1, -1, 0.5]'),
        center: await getKclCommandValue('[7.5, 3.2, 0]'),
        arcDegrees: await getKclCommandValue('180.5'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 2.5')
      expect(newCode).toContain('axis = [1, -1, 0.5]')
      expect(newCode).toContain('center = [7.5, 3.2, 0]')
      expect(newCode).toContain('arcDegrees = 180.5')
    })

    it('should handle mathematical expressions for parameters', async () => {
      const code = `
myCount = 10
mySpacing = 5
myOffset = 3
myAngle = 90

exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('myCount - myOffset'),
        axis: await getKclCommandValue('[mySpacing * 2, 0, 1]'),
        center: await getKclCommandValue('[mySpacing + myOffset, 0, 0]'),
        arcDegrees: await getKclCommandValue('myAngle * 2'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = myCount - myOffset')
      expect(newCode).toContain('axis = [mySpacing * 2, 0, 1]')
      expect(newCode).toContain('center = [mySpacing + myOffset, 0, 0]')
      expect(newCode).toContain('arcDegrees = myAngle * 2')
    })

    it('should prioritize array values over variable names when both exist', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      // Test the precedence by creating a mock axis that simulates the edge case
      const baseExpression = await getKclCommandValue('[1, 0, 0]')
      const mockAxisWithBothProperties = {
        ...baseExpression,
        variableName: 'someVariable', // This exists but should be ignored
        variableDeclarationAst: { type: 'VariableDeclaration' } as any,
        variableIdentifierAst: {
          type: 'Identifier',
          name: 'someVariable',
        } as any,
        insertIndex: 0,
        value: [1, 0, 0], // This should take precedence
      }

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('5'),
        axis: mockAxisWithBothProperties,
        center: await getKclCommandValue('[0, 0, 0]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 5')
      // Should use the array value, not the variable name
      expect(newCode).toContain('axis = [1, 0, 0]')
      expect(newCode).not.toContain('axis = someVariable')
      expect(newCode).toContain('center = [0, 0, 0]')
    })

    it('should create new pattern variable when selection is piped into named variable', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('6'),
        axis: 'Y',
        center: await getKclCommandValue('[0, 0, 0]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 6')
      expect(newCode).toContain('axis = Y')
      expect(newCode).toContain('center = [0, 0, 0]')
      // Should create new pattern variable referencing the named variable
      expect(newCode).toContain('exampleSketch = startSketchOn(XZ)')
      expect(newCode).toContain('|> extrude(length = 5)')
      expect(newCode).toContain('pattern001 = patternCircular3d(')
      expect(newCode).toContain('exampleSketch,') // References the original variable
    })

    it('should extend pipeline when selection is from unnamed pipeline', async () => {
      const code = `
sketch001 = startSketchOn(XZ)

startSketchOn(XY)
  |> circle(center = [1, 1], radius = 0.5)
  |> extrude(length = 3)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('8'),
        axis: 'Z',
        center: await getKclCommandValue('[2, 2, 0]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 8')
      expect(newCode).toContain('axis = Z')
      expect(newCode).toContain('center = [2, 2, 0]')
      // Should extend the unnamed pipeline
      expect(newCode).toContain('startSketchOn(XY)')
      expect(newCode).toContain('|> extrude(length = 3)')
      expect(newCode).toContain('|> patternCircular3d(')
    })

    it('should pipe pattern when selection is from unnamed standalone expression', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('4'),
        axis: await getKclCommandValue('[0, 1, 0]'),
        center: await getKclCommandValue('[5, 0, 0]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 4')
      expect(newCode).toContain('axis = [0, 1, 0]')
      expect(newCode).toContain('center = [5, 0, 0]')
      // Should pipe directly onto the unnamed expression
      expect(newCode).toContain('extrude(exampleSketch, length = -5)')
      expect(newCode).toContain('|> patternCircular3d(')
    })
  })

  describe('Testing addPatternLinear3D', () => {
    it('should add patternLinear3d with named axis', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('7'),
        distance: await getKclCommandValue('6'),
        axis: 'X',
        useOriginal: false,
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 7')
      expect(newCode).toContain('axis = X')
      expect(newCode).toContain('distance = 6')
      expect(newCode).toContain('useOriginal = false')
    })

    it('should add patternLinear3d with array axis', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('5'),
        distance: await getKclCommandValue('10'),
        axis: await getKclCommandValue('[1, 0, 1]'),
        useOriginal: true,
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 5')
      expect(newCode).toContain('axis = [1, 0, 1]')
      expect(newCode).toContain('distance = 10')
      expect(newCode).toContain('useOriginal = true')
    })

    it('should add patternLinear3d with minimal required parameters', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('3'),
        distance: await getKclCommandValue('4'),
        axis: 'Y',
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 3')
      expect(newCode).toContain('axis = Y')
      expect(newCode).toContain('distance = 4')
      expect(newCode).not.toContain('useOriginal')
    })

    it('should handle all optional parameters', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('6'),
        distance: await getKclCommandValue('8'),
        axis: 'Y',
        useOriginal: true,
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 6')
      expect(newCode).toContain('axis = Y')
      expect(newCode).toContain('distance = 8')
      expect(newCode).toContain('useOriginal = true')
    })

    it('should handle variable references for parameters', async () => {
      const code = `
myInstances = 8
myAxis = [0, 0, 1]
myDistance = 12

exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('myInstances'),
        distance: await getKclCommandValue('myDistance'),
        axis: await getKclCommandValue('myAxis'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = myInstances')
      expect(newCode).toContain('axis = myAxis')
      expect(newCode).toContain('distance = myDistance')
    })

    it('should handle decimal values for all parameters', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('2.5'),
        distance: await getKclCommandValue('7.5'),
        axis: await getKclCommandValue('[1, -1, 0.5]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 2.5')
      expect(newCode).toContain('axis = [1, -1, 0.5]')
      expect(newCode).toContain('distance = 7.5')
    })

    it('should handle mathematical expressions for parameters', async () => {
      const code = `
myCount = 10
mySpacing = 5
myOffset = 3

exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('myCount - myOffset'),
        distance: await getKclCommandValue('mySpacing + myOffset'),
        axis: await getKclCommandValue('[mySpacing * 2, 0, 1]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = myCount - myOffset')
      expect(newCode).toContain('axis = [mySpacing * 2, 0, 1]')
      expect(newCode).toContain('distance = mySpacing + myOffset')
    })

    it('should prioritize array values over variable names when both exist', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      // Test the precedence by creating a mock axis that simulates the edge case
      const baseExpression = await getKclCommandValue('[1, 0, 0]')
      const mockAxisWithBothProperties = {
        ...baseExpression,
        variableName: 'someVariable', // This exists but should be ignored
        variableDeclarationAst: { type: 'VariableDeclaration' } as any,
        variableIdentifierAst: {
          type: 'Identifier',
          name: 'someVariable',
        } as any,
        insertIndex: 0,
        value: [1, 0, 0], // This should take precedence
      }

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('5'),
        distance: await getKclCommandValue('8'),
        axis: mockAxisWithBothProperties,
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 5')
      // Should use the array value, not the variable name
      expect(newCode).toContain('axis = [1, 0, 0]')
      expect(newCode).not.toContain('axis = someVariable')
      expect(newCode).toContain('distance = 8')
    })

    it('should create new pattern variable when selection is piped into named variable', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('6'),
        distance: await getKclCommandValue('3'),
        axis: 'Y',
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 6')
      expect(newCode).toContain('axis = Y')
      expect(newCode).toContain('distance = 3')
      // Should create new pattern variable referencing the named variable
      expect(newCode).toContain('exampleSketch = startSketchOn(XZ)')
      expect(newCode).toContain('|> extrude(length = 5)')
      expect(newCode).toContain('pattern001 = patternLinear3d(')
      expect(newCode).toContain('exampleSketch,') // References the original variable
    })

    it('should extend pipeline when selection is from unnamed pipeline', async () => {
      const code = `
sketch001 = startSketchOn(XZ)

startSketchOn(XY)
  |> circle(center = [1, 1], radius = 0.5)
  |> extrude(length = 3)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('4'),
        distance: await getKclCommandValue('2'),
        axis: 'Z',
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 4')
      expect(newCode).toContain('axis = Z')
      expect(newCode).toContain('distance = 2')
      // Should extend the unnamed pipeline
      expect(newCode).toContain('startSketchOn(XY)')
      expect(newCode).toContain('|> extrude(length = 3)')
      expect(newCode).toContain('|> patternLinear3d(')
    })

    it('should pipe pattern when selection is from unnamed standalone expression', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('3'),
        distance: await getKclCommandValue('5'),
        axis: await getKclCommandValue('[0, 1, 0]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 3')
      expect(newCode).toContain('axis = [0, 1, 0]')
      expect(newCode).toContain('distance = 5')
      // Should pipe directly onto the unnamed expression
      expect(newCode).toContain('extrude(exampleSketch, length = -5)')
      expect(newCode).toContain('|> patternLinear3d(')
    })
  })
})

const GLOBAL_TIMEOUT_FOR_MODELING_MACHINE = 5000
describe('modelingMachine.test.ts', () => {
  // Define mock implementations that will be referenced in vi.mock calls
  vi.mock('@src/components/SetHorVertDistanceModal', () => ({
    createInfoModal: vi.fn(() => ({
      open: vi.fn().mockResolvedValue({
        value: '10',
        segName: 'test',
        valueNode: {},
        newVariableInsertIndex: 0,
        sign: 1,
      }),
    })),
    GetInfoModal: vi.fn(),
  }))

  vi.mock('@src/components/SetAngleLengthModal', () => ({
    createSetAngleLengthModal: vi.fn(() => ({
      open: vi.fn().mockResolvedValue({
        value: '45deg',
        segName: 'test',
        valueNode: {},
        newVariableInsertIndex: 0,
        sign: 1,
      }),
    })),
    SetAngleLengthModal: vi.fn(),
  }))

  // Add this function before the test cases
  // Utility function to wait for a condition to be met
  const waitForCondition = async (
    condition: () => boolean,
    timeout = GLOBAL_TIMEOUT_FOR_MODELING_MACHINE,
    interval = 100
  ) => {
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      try {
        if (condition()) {
          return true
        }
      } catch {
        // Ignore errors, keep polling
      }

      // Wait for the next interval
      await new Promise((resolve) => setTimeout(resolve, interval))
    }

    // Last attempt before failing
    return condition()
  }

  describe('modelingMachine - XState', () => {
    describe('when initialized', () => {
      it('should start in the idle state', () => {
        const actor = createActor(modelingMachine, {
          input: modelingMachineDefaultContext,
        }).start()
        const state = actor.getSnapshot().value

        // The machine should start in the idle state
        expect(state).toEqual({ idle: 'hidePlanes' })
      })
    })

    const makeStraightSegmentSnippet = (line: string) => ({
      code: `testVar1 = 55
testVar2 = 66
testVar3 = 77
testVar4 = 88
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [2263.04, -2721.2])
|> line(end = [78, 19])
|> ${line}
|> line(end = [75.72, 18.41])`,
      searchText: line,
    })
    const makeCircSnippet = (line: string) => ({
      code: `testVar1 = 55
testVar2 = 66
testVar3 = 77
testVar4 = 88
testVar5 = 99
testVar6 = 11
sketch001 = startSketchOn(YZ)
profile001 = ${line}
`,
      searchText: line,
    })
    const threePointCirceCode = `circleThreePoint(
sketch001,
p1 = [testVar1, testVar2],
p2 = [testVar3, testVar4],
p3 = [testVar5, testVar6],
)`
    const threePointCirceCodeLiterals = `circleThreePoint(
sketch001,
p1 = [281.18, 215.74],
p2 = [295.39, 269.96],
p3 = [342.51, 216.38],
)`

    type TestDetails = {
      name: string
      code: string
      searchText: string
      constraintIndex: number
      expectedResult: string
      filter?: string
    }

    const cases: {
      [strLibName: string]: {
        namedConstantConstraint: TestDetails[]
        removeAllConstraintsCases: TestDetails[]
        removeIndividualConstraintsCases: TestDetails[]
        deleteSegment: Omit<TestDetails, 'expectedResult' | 'constraintIndex'>[]
      }
    } = {
      line: {
        namedConstantConstraint: [
          {
            name: 'should constrain line x value',
            ...makeStraightSegmentSnippet('line(end = [16.27, 73.81])'),
            constraintIndex: 0,
            expectedResult: 'line(end = [test_variable,',
          },
          {
            name: 'should constrain line y value',
            ...makeStraightSegmentSnippet('line(end = [16.27, 73.81])'),
            constraintIndex: 1,
            expectedResult: 'line(end = [16.27, test_variable]',
          },
          {
            name: 'should constrain line absolute x value',
            ...makeStraightSegmentSnippet('line(endAbsolute = [16.27, 73.81])'),
            constraintIndex: 0,
            expectedResult: 'line(endAbsolute = [test_variable, 73.81]',
          },
          {
            name: 'should constrain line absolute y value',
            ...makeStraightSegmentSnippet('line(endAbsolute = [16.27, 73.81])'),
            constraintIndex: 1,
            expectedResult: 'line(endAbsolute = [16.27, test_variable]',
          },
        ],
        removeAllConstraintsCases: [
          {
            name: 'should un-constrain rel-line',
            ...makeStraightSegmentSnippet('line(end = [testVar1, testVar2])'),
            constraintIndex: 0,
            expectedResult: 'line(end = [55, 66])',
          },
          {
            name: 'should un-constrain abs-line',
            ...makeStraightSegmentSnippet(
              'line(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 0,
            expectedResult: 'line(end = [-2286.04, 2768.2]',
            // TODO un-constrains to relative line when it should not, expectedResult should be the following
            // expectedResult: 'line(endAbsolute = [55, 66]',
          },
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain line x value',
            ...makeStraightSegmentSnippet('line(end = [testVar1, testVar2])'),
            constraintIndex: 0,
            expectedResult: 'line(end = [55, testVar2]',
          },
          {
            name: 'should un-constrain line y value',
            ...makeStraightSegmentSnippet('line(end = [testVar1, testVar2])'),
            constraintIndex: 1,
            expectedResult: 'line(end = [testVar1, 66]',
          },
          {
            name: 'should un-constrain line absolute x value',
            ...makeStraightSegmentSnippet(
              'line(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 0,
            // expectedResult: 'line(end = [-2286.04, testVar2])',
            // // TODO should not swap from abs to relative, expected should be
            expectedResult: 'line(endAbsolute = [55, testVar2]',
          },
          {
            name: 'should un-constrain line absolute y value',
            ...makeStraightSegmentSnippet(
              'line(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 1,
            expectedResult: 'line(endAbsolute = [testVar1, 66])',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete rel-line',
            ...makeStraightSegmentSnippet('line(end = [testVar1, testVar2])'),
          },
          {
            name: 'should delete abs-line',
            ...makeStraightSegmentSnippet(
              'line(endAbsolute = [testVar1, testVar2])'
            ),
          },
        ],
      },
      xLine: {
        namedConstantConstraint: [
          {
            name: 'should constrain xLine x value',
            ...makeStraightSegmentSnippet('xLine(length = 15)'),
            constraintIndex: 1,
            expectedResult: 'xLine(length = test_variable)',
          },
          {
            name: 'should constrain xLine x absolute value',
            ...makeStraightSegmentSnippet('xLine(endAbsolute = 15)'),
            constraintIndex: 1,
            expectedResult: 'xLine(endAbsolute = test_variable)',
          },
        ],
        removeAllConstraintsCases: [
          {
            name: 'should un-constrain xLine',
            ...makeStraightSegmentSnippet('xLine(length = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'line(end = [55, 0])',
          },
          {
            name: 'should un-constrain xLine absolute value',
            ...makeStraightSegmentSnippet('xLine(endAbsolute = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'line(end = [-2286.04, 0])',
            // TODO un-constrains to relative line when it should not, expectedResult should be the following
            // expectedResult: 'line(endAbsolute = [55, 0])',
          },
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain xLine x value',
            ...makeStraightSegmentSnippet('xLine(length = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'xLine(length = 55)',
          },
          {
            name: 'should un-constrain xLine x absolute value',
            ...makeStraightSegmentSnippet('xLine(endAbsolute = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'xLine(endAbsolute = 55)',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete xLine',
            ...makeStraightSegmentSnippet('xLine(length = 15)'),
          },
          {
            name: 'should delete xLine',
            ...makeStraightSegmentSnippet('xLine(endAbsolute = 15)'),
          },
        ],
      },
      yLine: {
        namedConstantConstraint: [
          {
            name: 'should constrain yLine y value',
            ...makeStraightSegmentSnippet('yLine(length = 15)'),
            constraintIndex: 1,
            expectedResult: 'yLine(length = test_variable)',
          },
          {
            name: 'should constrain yLine y absolute value',
            ...makeStraightSegmentSnippet('yLine(endAbsolute = 15)'),
            constraintIndex: 1,
            expectedResult: 'yLine(endAbsolute = test_variable)',
          },
        ],
        removeAllConstraintsCases: [
          {
            name: 'should un-constrain yLine value',
            ...makeStraightSegmentSnippet('yLine(length = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'line(end = [0, 55])',
          },
          {
            name: 'should un-constrain yLine absolute value',
            ...makeStraightSegmentSnippet('yLine(endAbsolute = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'line(end = [0, 2757.2])',
            // TODO un-constrains to relative line when it should not, expectedResult should be the following
            // expectedResult: 'line(endAbsolute = [0, 55])',
          },
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain yLine y value',
            ...makeStraightSegmentSnippet('yLine(length = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'yLine(length = 55)',
          },
          {
            name: 'should un-constrain yLine y absolute value',
            ...makeStraightSegmentSnippet('yLine(endAbsolute = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'yLine(endAbsolute = 55)',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete yLine',
            ...makeStraightSegmentSnippet('yLine(length = 15)'),
          },
          {
            name: 'should delete yLine abs',
            ...makeStraightSegmentSnippet('yLine(endAbsolute = 15)'),
          },
        ],
      },
      angledLine: {
        namedConstantConstraint: [
          {
            name: 'should constrain angledLine, angle value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, length = 100)'
            ),
            constraintIndex: 0,
            expectedResult: 'angledLine(angle = test_variable, length = 100)',
          },
          {
            name: 'should constrain angledLine, length value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, length = 100)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = 45deg, length = test_variable)',
          },
          {
            name: 'should constrain angledLine, endAbsoluteY value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, endAbsoluteY = 5)'
            ),
            constraintIndex: 1,
            expectedResult:
              'angledLine(angle = 45deg, endAbsoluteY = test_variable)',
          },
          {
            name: 'should constrain angledLine, endAbsoluteX value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, endAbsoluteX = 5)'
            ),
            constraintIndex: 1,
            expectedResult:
              'angledLine(angle = 45deg, endAbsoluteX = test_variable)',
          },
          {
            name: 'should constrain angledLine, lengthY value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, lengthY = 5)'
            ),
            constraintIndex: 1,
            expectedResult:
              'angledLine(angle = 45deg, lengthY = test_variable)',
          },
          {
            name: 'should constrain angledLine, lengthX value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, lengthX = 5)'
            ),
            constraintIndex: 1,
            expectedResult:
              'angledLine(angle = 45deg, lengthX = test_variable)',
          },
        ],
        removeAllConstraintsCases: [
          {
            name: 'should un-constrain angledLine',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, length = testVar2)'
            ),
            constraintIndex: 0,
            expectedResult: 'line(end = [37.86, 54.06]',
          },
          {
            name: 'should un-constrain angledLine, endAbsoluteY',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, endAbsoluteY = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'line(end = [1938.31, 2768.2])',
          },
          {
            name: 'should un-constrain angledLine, endAbsoluteX',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, endAbsoluteX = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'line(end = [-2275.04, -3249.09])',
          },
          {
            name: 'should un-constrain angledLine, lengthY',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, lengthY = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'line(end = [46.21, 66])',
          },
          {
            name: 'should un-constrain angledLine, lengthX',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, lengthX = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'line(end = [66, 94.26])',
          },
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain angledLine, angle value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, length = testVar2)'
            ),
            constraintIndex: 0,
            expectedResult: 'angledLine(angle = 55deg, length = testVar2)',
          },
          {
            name: 'should un-constrain angledLine, length value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, length = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, length = 66)',
          },
          {
            name: 'should un-constrain angledLine, endAbsoluteY value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, endAbsoluteY = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, endAbsoluteY = 66)',
          },
          {
            name: 'should un-constrain angledLine, endAbsoluteX value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, endAbsoluteX = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, endAbsoluteX = 66)',
          },
          {
            name: 'should un-constrain angledLine, lengthY value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, lengthY = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, lengthY = 66)',
          },
          {
            name: 'should un-constrain angledLine, lengthX value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, lengthX = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, lengthX = 66)',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete angledLine, angle length',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, length = 100)'
            ),
          },
          {
            name: 'should delete angledLine, endAbsoluteY',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, endAbsoluteY = 5)'
            ),
          },
          {
            name: 'should delete angledLine, endAbsoluteX',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, endAbsoluteX = 5)'
            ),
          },
          {
            name: 'should delete angledLine, lengthY',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, lengthY = 5)'
            ),
          },
          {
            name: 'should delete angledLine, lengthX',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, lengthX = 5)'
            ),
          },
        ],
      },
      circle: {
        namedConstantConstraint: [
          {
            name: 'should constrain circle, radius value',
            ...makeCircSnippet(
              'circle(sketch001, center = [140.82, 183.92], radius = 74.18)'
            ),
            constraintIndex: 0,
            expectedResult:
              'circle(sketch001, center = [140.82, 183.92], radius = test_variable)',
          },
          {
            name: 'should constrain circle, center x value',
            ...makeCircSnippet(
              'circle(sketch001, center = [140.82, 183.92], radius = 74.18)'
            ),
            constraintIndex: 1,
            expectedResult:
              'circle(sketch001, center = [test_variable, 183.92], radius = 74.18)',
          },
          {
            name: 'should constrain circle, center y value',
            ...makeCircSnippet(
              'circle(sketch001, center = [140.82, 183.92], radius = 74.18)'
            ),
            constraintIndex: 2,
            expectedResult:
              'circle(sketch001, center = [140.82, test_variable], radius = 74.18)',
          },
        ],
        removeAllConstraintsCases: [
          // TODO circle when remove all is working
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain circle, radius value',
            ...makeCircSnippet(
              'circle(sketch001, center = [140.82, 183.92], radius = testVar1)'
            ),
            constraintIndex: 0,
            expectedResult:
              'circle(sketch001, center = [140.82, 183.92], radius = 55)',
          },
          {
            name: 'should un-constrain circle, center x value',
            ...makeCircSnippet(
              'circle(sketch001, center = [testVar1, testVar2], radius = 74.18)'
            ),
            constraintIndex: 1,
            expectedResult:
              'circle(sketch001, center = [55, testVar2], radius = 74.18)',
          },
          {
            name: 'should un-constrain circle, center y value',
            ...makeCircSnippet(
              'circle(sketch001, center = [testVar1, testVar2], radius = 74.18)'
            ),
            constraintIndex: 2,
            expectedResult:
              'circle(sketch001, center = [testVar1, 66], radius = 74.18)',
          },
        ],
        deleteSegment: [
          /** TODO once circle has delete implemented */
        ],
      },
      circleThreePoint: {
        namedConstantConstraint: [
          {
            name: 'should constrain circleThreePoint, p1 x value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 0,
            expectedResult: 'p1 = [test_variable, 215.74]',
            filter: 'p1',
          },
          {
            name: 'should constrain circleThreePoint, p1 y value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 1,
            expectedResult: 'p1 = [281.18, test_variable]',
            filter: 'p1',
          },
          {
            name: 'should constrain circleThreePoint, p2 x value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 0,
            expectedResult: 'p2 = [test_variable, 269.96]',
            filter: 'p2',
          },
          {
            name: 'should constrain circleThreePoint, p2 y value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 1,
            expectedResult: 'p2 = [295.39, test_variable]',
            filter: 'p2',
          },
          {
            name: 'should constrain circleThreePoint, p3 x value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 0,
            expectedResult: 'p3 = [test_variable, 216.38]',
            filter: 'p3',
          },
          {
            name: 'should constrain circleThreePoint, p3 y value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 1,
            expectedResult: 'p3 = [342.51, test_variable]',
            filter: 'p3',
          },
        ],
        removeAllConstraintsCases: [
          // TODO circleThreePoint when remove all is working
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain circleThreePoint, p1 x value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 0,
            expectedResult: 'p1 = [55, testVar2]',
            filter: 'p1',
          },
          {
            name: 'should un-constrain circleThreePoint, p1 y value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 1,
            expectedResult: 'p1 = [testVar1, 66]',
            filter: 'p1',
          },
          {
            name: 'should un-constrain circleThreePoint, p2 x value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 0,
            expectedResult: 'p2 = [77, testVar4]',
            filter: 'p2',
          },
          {
            name: 'should un-constrain circleThreePoint, p2 y value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 1,
            expectedResult: 'p2 = [testVar3, 88]',
            filter: 'p2',
          },
          {
            name: 'should un-constrain circleThreePoint, p3 x value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 0,
            expectedResult: 'p3 = [99, testVar6]',
            filter: 'p3',
          },
          {
            name: 'should un-constrain circleThreePoint, p3 y value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 1,
            expectedResult: 'p3 = [testVar5, 11]',
            filter: 'p3',
          },
        ],
        deleteSegment: [
          /**TODO once three point circle has delete implemented */
        ],
      },
      tangentialArc: {
        namedConstantConstraint: [
          {
            name: 'should constrain tangentialArc absolute x value',
            ...makeStraightSegmentSnippet(
              'tangentialArc(endAbsolute = [176.11, 19.49])'
            ),
            constraintIndex: 1,
            expectedResult: 'endAbsolute = [test_variable, 19.49]',
          },
          {
            name: 'should constrain tangentialArc absolute y value',
            ...makeStraightSegmentSnippet(
              'tangentialArc(endAbsolute = [176.11, 19.49])'
            ),
            constraintIndex: 2,
            expectedResult: 'endAbsolute = [176.11, test_variable]',
          },
          // TODO tangentialArc relative when that's working
        ],
        removeAllConstraintsCases: [
          // TODO tangentialArc when remove all is working
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain tangentialArc absolute x value',
            ...makeStraightSegmentSnippet(
              'tangentialArc(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 1,
            expectedResult: 'endAbsolute = [55, testVar2]',
          },
          {
            name: 'should un-constrain tangentialArc absolute y value',
            ...makeStraightSegmentSnippet(
              'tangentialArc(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 2,
            expectedResult: 'endAbsolute = [testVar1, 66]',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete tangentialArc absolute',
            ...makeStraightSegmentSnippet(
              'tangentialArc(endAbsolute = [176.11, 19.49])'
            ),
          },
        ],
      },
      arc: {
        namedConstantConstraint: [
          {
            name: 'should constrain threePoint Arc interior x value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
            ),
            constraintIndex: 0,
            expectedResult: 'interiorAbsolute = [test_variable, 103.92]',
            filter: ARG_INTERIOR_ABSOLUTE,
          },
          {
            name: 'should constrain threePoint Arc interior y value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
            ),
            constraintIndex: 1,
            expectedResult: 'interiorAbsolute = [379.93, test_variable]',
            filter: ARG_INTERIOR_ABSOLUTE,
          },
          {
            name: 'should constrain threePoint Arc end x value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
            ),
            constraintIndex: 0,
            expectedResult: 'endAbsolute = [test_variable, 162.89]',
            filter: ARG_END_ABSOLUTE,
          },
          {
            name: 'should constrain threePoint Arc end y value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
            ),
            constraintIndex: 1,
            expectedResult: 'endAbsolute = [386.2, test_variable]',
            filter: ARG_END_ABSOLUTE,
          },
          // TODO do other kwargs for arc
        ],
        removeAllConstraintsCases: [
          // TODO arc when remove all is working
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain threePoint Arc interior x value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [testVar1, testVar2], endAbsolute = [testVar3, testVar4])'
            ),
            constraintIndex: 0,
            expectedResult: 'interiorAbsolute = [55, testVar2]',
            filter: ARG_INTERIOR_ABSOLUTE,
          },
          {
            name: 'should un-constrain threePoint Arc interior y value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [testVar1, testVar2], endAbsolute = [testVar3, testVar4])'
            ),
            constraintIndex: 1,
            expectedResult: 'interiorAbsolute = [testVar1, 66]',
            filter: ARG_INTERIOR_ABSOLUTE,
          },
          {
            name: 'should un-constrain threePoint Arc end x value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [testVar1, testVar2], endAbsolute = [testVar3, testVar4])'
            ),
            constraintIndex: 0,
            expectedResult: 'endAbsolute = [77, testVar4]',
            filter: ARG_END_ABSOLUTE,
          },
          {
            name: 'should un-constrain threePoint Arc end y value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [testVar1, testVar2], endAbsolute = [testVar3, testVar4])'
            ),
            constraintIndex: 1,
            expectedResult: 'endAbsolute = [testVar3, 88]',
            filter: ARG_END_ABSOLUTE,
          },
        ],
        deleteSegment: [
          {
            name: 'should delete threePoint Arc (interior, end)',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
            ),
          },
        ],
      },
    }

    describe('Deleting segment with three dot menu', () => {
      const namedConstantConstraintCases = Object.values(cases).flatMap(
        (caseGroup) => caseGroup.deleteSegment
      )
      namedConstantConstraintCases.forEach(
        ({ name, code, searchText, filter }) => {
          it(name, async () => {
            const indexOfInterest = code.indexOf(searchText)

            const ast = assertParse(code)

            await kclManager.executeAst({ ast })

            expect(kclManager.errors).toEqual([])

            // segment artifact with that source range
            const artifact = [...kclManager.artifactGraph].find(
              ([_, artifact]) =>
                artifact?.type === 'segment' &&
                artifact.codeRef.range[0] <= indexOfInterest &&
                indexOfInterest <= artifact.codeRef.range[1]
            )?.[1]
            if (!artifact || !('codeRef' in artifact)) {
              throw new Error(
                'Artifact not found or invalid artifact structure'
              )
            }

            const actor = createActor(modelingMachine, {
              input: modelingMachineDefaultContext,
            }).start()

            // Send event to transition to sketch mode
            actor.send({
              type: 'Set selection',
              data: {
                selectionType: 'mirrorCodeMirrorSelections',
                selection: {
                  graphSelections: [
                    {
                      artifact: artifact,
                      codeRef: artifact.codeRef,
                    },
                  ],
                  otherSelections: [],
                },
              },
            })
            actor.send({ type: 'Enter sketch' })

            // Check that we're in the sketch state
            let state = actor.getSnapshot()
            expect(state.value).toBe('animating to existing sketch')

            // wait for it to transition
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              return snapshot.value !== 'animating to existing sketch'
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              const a1 = JSON.stringify(snapshot.value)
              const a2 = JSON.stringify({
                Sketch: { SketchIdle: 'scene drawn' },
              })
              return a1 !== a2
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            const callExp = getNodeFromPath<Node<CallExpressionKw>>(
              kclManager.ast,
              artifact.codeRef.pathToNode,
              'CallExpressionKw'
            )
            if (err(callExp)) {
              throw new Error('Failed to get CallExpressionKw node')
            }
            const constraintInfo = getConstraintInfoKw(
              callExp.node,
              codeManager.code,
              artifact.codeRef.pathToNode,
              filter
            )
            const constraint = constraintInfo[0]

            // Now that we're in sketchIdle state, test the "Constrain with named value" event
            actor.send({
              type: 'Delete segment',
              data: constraint.pathToNode,
            })

            // Wait for the state to change in response to the constraint
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              // Check if we've transitioned to a different state
              return (
                JSON.stringify(snapshot.value) !==
                JSON.stringify({
                  Sketch: { SketchIdle: 'set up segments' },
                })
              )
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            const startTime = Date.now()
            while (
              codeManager.code.includes(searchText) &&
              Date.now() - startTime < GLOBAL_TIMEOUT_FOR_MODELING_MACHINE
            ) {
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
            expect(codeManager.code).not.toContain(searchText)
          }, 10_000)
        }
      )
    })
    describe('Adding segment overlay constraints', () => {
      const namedConstantConstraintCases = Object.values(cases).flatMap(
        (caseGroup) => caseGroup.namedConstantConstraint
      )
      namedConstantConstraintCases.forEach(
        ({
          name,
          code,
          searchText,
          constraintIndex,
          expectedResult,
          filter,
        }) => {
          it(name, async () => {
            const indexOfInterest = code.indexOf(searchText)

            const ast = assertParse(code)

            await kclManager.executeAst({ ast })

            expect(kclManager.errors).toEqual([])

            // segment artifact with that source range
            const artifact = [...kclManager.artifactGraph].find(
              ([_, artifact]) =>
                artifact?.type === 'segment' &&
                artifact.codeRef.range[0] <= indexOfInterest &&
                indexOfInterest <= artifact.codeRef.range[1]
            )?.[1]
            if (!artifact || !('codeRef' in artifact)) {
              throw new Error(
                'Artifact not found or invalid artifact structure'
              )
            }

            const actor = createActor(modelingMachine, {
              input: modelingMachineDefaultContext,
            }).start()

            // Send event to transition to sketch mode
            actor.send({
              type: 'Set selection',
              data: {
                selectionType: 'mirrorCodeMirrorSelections',
                selection: {
                  graphSelections: [
                    {
                      artifact: artifact,
                      codeRef: artifact.codeRef,
                    },
                  ],
                  otherSelections: [],
                },
              },
            })
            actor.send({ type: 'Enter sketch' })

            // Check that we're in the sketch state
            let state = actor.getSnapshot()
            expect(state.value).toBe('animating to existing sketch')

            // wait for it to transition
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              return snapshot.value !== 'animating to existing sketch'
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            // After the condition is met, do the actual assertion
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              const a1 = JSON.stringify(snapshot.value)
              const a2 = JSON.stringify({
                Sketch: { SketchIdle: 'scene drawn' },
              })
              return a1 !== a2
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            const callExp = getNodeFromPath<Node<CallExpressionKw>>(
              kclManager.ast,
              artifact.codeRef.pathToNode,
              'CallExpressionKw'
            )
            if (err(callExp)) {
              throw new Error('Failed to get CallExpressionKw node')
            }
            const constraintInfo = getConstraintInfoKw(
              callExp.node,
              codeManager.code,
              artifact.codeRef.pathToNode,
              filter
            )
            const constraint = constraintInfo[constraintIndex]

            // Now that we're in sketchIdle state, test the "Constrain with named value" event
            actor.send({
              type: 'Constrain with named value',
              data: {
                currentValue: {
                  valueText: constraint.value,
                  pathToNode: constraint.pathToNode,
                  variableName: 'test_variable',
                },
                // Use type assertion to mock the complex type
                namedValue: {
                  valueText: '20',
                  variableName: 'test_variable',
                  insertIndex: 0,
                  valueCalculated: '20',
                  variableDeclarationAst: createVariableDeclaration(
                    'test_variable',
                    createLiteral('20')
                  ),
                  variableIdentifierAst: createIdentifier(
                    'test_variable'
                  ) as any,
                  valueAst: createLiteral('20'),
                },
              },
            })

            // Wait for the state to change in response to the constraint
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              // Check if we've transitioned to a different state
              return (
                JSON.stringify(snapshot.value) !==
                JSON.stringify({
                  Sketch: { SketchIdle: 'set up segments' },
                })
              )
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              // Check if we've transitioned to a different state
              return (
                JSON.stringify(snapshot.value) !==
                JSON.stringify({ Sketch: 'Converting to named value' })
              )
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)
            expect(codeManager.code).toContain(expectedResult)
          }, 10_000)
        }
      )
    })
    describe('removing individual constraints with segment overlay events', () => {
      const removeIndividualConstraintsCases = Object.values(cases).flatMap(
        (caseGroup) => caseGroup.removeIndividualConstraintsCases
      )

      removeIndividualConstraintsCases.forEach(
        ({
          name,
          code,
          searchText,
          constraintIndex,
          expectedResult,
          filter,
        }) => {
          it(name, async () => {
            const indexOfInterest = code.indexOf(searchText)

            const ast = assertParse(code)

            await kclManager.executeAst({ ast })

            expect(kclManager.errors).toEqual([])

            // segment artifact with that source range
            const artifact = [...kclManager.artifactGraph].find(
              ([_, artifact]) =>
                artifact?.type === 'segment' &&
                artifact.codeRef.range[0] <= indexOfInterest &&
                indexOfInterest <= artifact.codeRef.range[1]
            )?.[1]
            if (!artifact || !('codeRef' in artifact)) {
              throw new Error(
                'Artifact not found or invalid artifact structure'
              )
            }

            const actor = createActor(modelingMachine, {
              input: modelingMachineDefaultContext,
            }).start()

            // Send event to transition to sketch mode
            actor.send({
              type: 'Set selection',
              data: {
                selectionType: 'mirrorCodeMirrorSelections',
                selection: {
                  graphSelections: [
                    {
                      artifact: artifact,
                      codeRef: artifact.codeRef,
                    },
                  ],
                  otherSelections: [],
                },
              },
            })
            actor.send({ type: 'Enter sketch' })

            // Check that we're in the sketch state
            let state = actor.getSnapshot()
            expect(state.value).toBe('animating to existing sketch')

            // wait for it to transition
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              return snapshot.value !== 'animating to existing sketch'
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            // After the condition is met, do the actual assertion

            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              const a1 = JSON.stringify(snapshot.value)
              const a2 = JSON.stringify({
                Sketch: { SketchIdle: 'scene drawn' },
              })
              return a1 !== a2
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            const callExp = getNodeFromPath<Node<CallExpressionKw>>(
              kclManager.ast,
              artifact.codeRef.pathToNode,
              'CallExpressionKw'
            )
            if (err(callExp)) {
              throw new Error('Failed to get CallExpressionKw node')
            }
            const constraintInfo = getConstraintInfoKw(
              callExp.node,
              codeManager.code,
              artifact.codeRef.pathToNode,
              filter
            )
            const constraint = constraintInfo[constraintIndex]
            console.log('constraint', constraint)
            if (!constraint.argPosition) {
              throw new Error(
                `Constraint at index ${constraintIndex} does not have argPosition`
              )
            }

            const mod = removeSingleConstraintInfo(
              constraint.pathToNode,
              constraint.argPosition,
              ast,
              kclManager.variables,
              removeSingleConstraint,
              transformAstSketchLines
            )
            if (!mod) {
              throw new Error('Failed to remove constraint info')
            }
            const codeRecast = recast(mod.modifiedAst)

            expect(codeRecast).toContain(expectedResult)
          }, 10_000)
        }
      )
    })
    describe('Removing segment overlay constraints', () => {
      const removeAllConstraintsCases = Object.values(cases).flatMap(
        (caseGroup) => caseGroup.removeAllConstraintsCases
      )

      removeAllConstraintsCases.forEach(
        ({
          name,
          code,
          searchText,
          constraintIndex,
          expectedResult,
          filter,
        }) => {
          it(name, async () => {
            const indexOfInterest = code.indexOf(searchText)

            const ast = assertParse(code)

            await kclManager.executeAst({ ast })

            expect(kclManager.errors).toEqual([])

            // segment artifact with that source range
            const artifact = [...kclManager.artifactGraph].find(
              ([_, artifact]) =>
                artifact?.type === 'segment' &&
                artifact.codeRef.range[0] <= indexOfInterest &&
                indexOfInterest <= artifact.codeRef.range[1]
            )?.[1]
            if (!artifact || !('codeRef' in artifact)) {
              throw new Error(
                'Artifact not found or invalid artifact structure'
              )
            }

            const actor = createActor(modelingMachine, {
              input: modelingMachineDefaultContext,
            }).start()

            // Send event to transition to sketch mode
            actor.send({
              type: 'Set selection',
              data: {
                selectionType: 'mirrorCodeMirrorSelections',
                selection: {
                  graphSelections: [
                    {
                      artifact: artifact,
                      codeRef: artifact.codeRef,
                    },
                  ],
                  otherSelections: [],
                },
              },
            })
            actor.send({ type: 'Enter sketch' })

            // Check that we're in the sketch state
            let state = actor.getSnapshot()
            expect(state.value).toBe('animating to existing sketch')

            // wait for it to transition
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              return snapshot.value !== 'animating to existing sketch'
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            // After the condition is met, do the actual assertion
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              const a1 = JSON.stringify(snapshot.value)
              const a2 = JSON.stringify({
                Sketch: { SketchIdle: 'scene drawn' },
              })
              return a1 !== a2
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            const callExp = getNodeFromPath<Node<CallExpressionKw>>(
              kclManager.ast,
              artifact.codeRef.pathToNode,
              'CallExpressionKw'
            )
            if (err(callExp)) {
              throw new Error('Failed to get CallExpressionKw node')
            }

            // Now that we're in sketchIdle state, test the "Constrain with named value" event
            actor.send({
              type: 'Constrain remove constraints',
              data: artifact.codeRef.pathToNode,
            })

            // Wait for the state to change in response to the constraint
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              // Check if we've transitioned to a different state
              return (
                JSON.stringify(snapshot.value) !==
                JSON.stringify({
                  Sketch: { SketchIdle: 'set up segments' },
                })
              )
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              // Check if we've transitioned to a different state
              return (
                JSON.stringify(snapshot.value) !==
                JSON.stringify({ Sketch: 'Constrain remove constraints' })
              )
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)
            const startTime = Date.now()
            while (
              !codeManager.code.includes(expectedResult) &&
              Date.now() - startTime < GLOBAL_TIMEOUT_FOR_MODELING_MACHINE
            ) {
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
            expect(codeManager.code).toContain(expectedResult)
          }, 10_000)
        }
      )
    })
  })
})
