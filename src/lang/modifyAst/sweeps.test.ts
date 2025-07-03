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
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { Node } from '@rust/kcl-lib/bindings/Node'

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

async function getKclCommandValue(value: string) {
  const result = await stringToKclExpression(value)
  if (err(result) || 'errors' in result) {
    throw new Error(`Couldn't create kcl expression`)
  }

  return result
}

async function runNewAstAndCheckForSweep(ast: Node<Program>) {
  const { artifactGraph } = await enginelessExecutor(ast)
  console.log('artifactGraph', artifactGraph)
  const sweepArtifact = artifactGraph.values().find((a) => a.type === 'sweep')
  expect(sweepArtifact).toBeDefined()
}

describe('Testing addExtrude', () => {
  it('should push a call in pipe if selection was in variable-less pipe', async () => {
    const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
`
    const { ast, sketches } = await getAstAndSketchSelections(code)
    const length = await getKclCommandValue('1')
    const result = addExtrude({ ast, sketches, length })
    if (err(result)) throw result
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`|> extrude(length = 1)`)
    await runNewAstAndCheckForSweep(result.modifiedAst)
  })

  it('should push a call with variable if selection was in variable profile', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
`
    const { ast, sketches } = await getAstAndSketchSelections(code)
    const length = await getKclCommandValue('2')
    const result = addExtrude({ ast, sketches, length })
    if (err(result)) throw result
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`extrude001 = extrude(profile001, length = 2)`)
    await runNewAstAndCheckForSweep(result.modifiedAst)
  })

  it('should push a call with variable if selection was in variable pipe', async () => {
    const code = `profile001 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
`
    const { ast, sketches } = await getAstAndSketchSelections(code)
    const length = await getKclCommandValue('3')
    const result = addExtrude({ ast, sketches, length })
    if (err(result)) throw result
    await runNewAstAndCheckForSweep(result.modifiedAst)
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`extrude001 = extrude(profile001, length = 3)`)
  })

  it('should push a call with many compatible optional args if asked', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
`
    const { ast, sketches } = await getAstAndSketchSelections(code)
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
    expect(newCode).toContain(code)
    expect(newCode).toContain(`extrude001 = extrude(
  profile001,
  length = 10,
  bidirectionalLength = 20,
  twistAngle = 30,
)`)
  })

  // TODO: missing edit flow test

  // TODO: missing multi-profile test
})

describe('Testing addSweep', () => {
  it('should push a call with variable and all compatible optional args', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
sketch002 = startSketchOn(XZ)
profile002 = startProfile(sketch002, at = [0, 0])
  |> xLine(length = -5)
  |> tangentialArc(endAbsolute = [-20, 5])
`
    const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
    const artifact1 = artifactGraph.values().find((a) => a.type === 'path')
    const artifact2 = [...artifactGraph.values()].findLast(
      (a) => a.type === 'path'
    )
    if (!artifact1 || !artifact2) {
      throw new Error('Artifact not found in the graph')
    }

    const sketches = createSelectionFromPathArtifact([artifact1])
    const path = createSelectionFromPathArtifact([artifact2])
    const sectional = true
    const relativeTo = 'sketchPlane'
    const result = addSweep({
      ast,
      sketches,
      path,
      sectional,
      relativeTo,
    })
    if (err(result)) throw result
    await runNewAstAndCheckForSweep(result.modifiedAst)
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`sweep001 = sweep(
  profile001,
  path = profile002,
  sectional = true,
  relativeTo = 'sketchPlane',
)`)
  })

  // TODO: missing edit flow test

  // TODO: missing multi-profile test
})

describe('Testing addLoft', () => {
  it('should push a call with variable and all optional args if asked', async () => {
    const code = `sketch001 = startSketchOn(XZ)
profile001 = circle(sketch001, center = [0, 0], radius = 30)
plane001 = offsetPlane(XZ, offset = 50)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 20)
`
    const { ast, sketches } = await getAstAndSketchSelections(code)
    expect(sketches.graphSelections).toHaveLength(2)
    const vDegree = await getKclCommandValue('3')
    const result = addLoft({
      ast,
      sketches,
      vDegree,
    })
    if (err(result)) throw result
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(
      `loft001 = loft([profile001, profile002], vDegree = 3)`
    )
    // Don't think we can find the artifact here for loft?
  })

  // TODO: missing edit flow test
})

describe('Testing addRevolve', () => {
  it('should push a call with variable and compatible optional args if asked', async () => {
    const code = `sketch001 = startSketchOn(XZ)
profile001 = circle(sketch001, center = [3, 0], radius = 1)
`
    const { ast, sketches } = await getAstAndSketchSelections(code)
    expect(sketches.graphSelections).toHaveLength(1)
    const result = addRevolve({
      ast,
      sketches,
      angle: await getKclCommandValue('1'),
      axisOrEdge: 'Axis',
      axis: 'X',
      edge: undefined,
      symmetric: false,
      bidirectionalAngle: await getKclCommandValue('2'),
    })
    if (err(result)) throw result
    await runNewAstAndCheckForSweep(result.modifiedAst)
    const newCode = recast(result.modifiedAst)
    console.log(newCode)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`revolve001 = revolve(
  profile001,
  angle = 1,
  axis = X,
  bidirectionalAngle = 2,
)`)
  })

  // TODO: missing edit flow test

  // TODO: missing multi-profile test
})
