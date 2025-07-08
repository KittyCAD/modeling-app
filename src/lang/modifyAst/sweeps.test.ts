import {
  type Artifact,
  assertParse,
  type CodeRef,
  type Program,
  recast,
} from '@src/lang/wasm'
import type { Selection, Selections } from '@src/lib/selections'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import {
  addExtrude,
  addLoft,
  addRevolve,
  addSweep,
} from '@src/lang/modifyAst/sweeps'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { getKclCommandValue } from '@src/lang/modifyAst/utils.test'

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

async function getAstAndSketchSelections(code: string) {
  const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
  const artifacts = [...artifactGraph.values()].filter((a) => a.type === 'path')
  if (artifacts.length === 0) {
    throw new Error('Artifact not found in the graph')
  }
  const sketches = createSelectionFromPathArtifact(artifacts)
  return { ast, sketches }
}

async function runNewAstAndCheckForSweep(ast: Node<Program>) {
  const { artifactGraph } = await enginelessExecutor(ast)
  const sweepArtifact = [...artifactGraph.values()].find(
    (a) => a.type === 'sweep'
  )
  expect(sweepArtifact).toBeDefined()
}

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
    const { ast, sketches } = await getAstAndSketchSelections(circleProfileCode)
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
    const { ast, sketches } = await getAstAndSketchSelections(circleProfileCode)
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
    const { ast, sketches } = await getAstAndSketchSelections(circleProfileCode)
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
    const result = addExtrude({ ast, sketches, length, symmetric, nodeToEdit })
    if (err(result)) throw result
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(`${circleProfileCode}
extrude001 = extrude(profile001, length = 2)`)
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
    const artifact1 = [...artifactGraph.values()].find((a) => a.type === 'path')
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
    expect(newCode).toContain(`sweep001 = sweep(profile001, path = profile002)`)
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
    const axisOrEdge = 'Axis'
    const axis = 'X'
    const result = addRevolve({ ast, sketches, angle, axisOrEdge, axis })
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
    const axisOrEdge = 'Axis'
    const axis = 'X'
    const symmetric = true
    const result = addRevolve({
      ast,
      sketches,
      angle,
      axisOrEdge,
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
    const axisOrEdge = 'Axis'
    const axis = 'X'
    const result = addRevolve({
      ast,
      sketches,
      angle,
      axisOrEdge,
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
    const axisOrEdge = 'Edge'
    const result = addRevolve({ ast, sketches, angle, axisOrEdge, edge })
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
    const axisOrEdge = 'Edge'
    const result = addRevolve({ ast, sketches, angle, axisOrEdge, edge })
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
    const { ast, sketches } = await getAstAndSketchSelections(code)
    expect(sketches.graphSelections).toHaveLength(1)
    const angle = await getKclCommandValue('20')
    const bidirectionalAngle = await getKclCommandValue('30')
    const axisOrEdge = 'Axis'
    const axis = 'Y'
    const nodeToEdit = createPathToNodeForLastVariable(ast)
    const result = addRevolve({
      ast,
      sketches,
      angle,
      bidirectionalAngle,
      axisOrEdge,
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
