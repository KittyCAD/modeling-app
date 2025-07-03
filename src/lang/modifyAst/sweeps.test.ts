import {
  type Artifact,
  assertParse,
  type CodeRef,
  recast,
} from '@src/lang/wasm'
import type { Selections } from '@src/lib/selections'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { addExtrude, addSweep } from '@src/lang/modifyAst/sweeps'
import { stringToKclExpression } from '@src/lib/kclHelpers'

async function getAstAndArtifactGraph(code: string) {
  const ast = assertParse(code)
  if (err(ast)) throw ast

  const { artifactGraph } = await enginelessExecutor(ast)
  return { ast, artifactGraph }
}

function createSelectionFromPathArtifact(
  artifact: Artifact & { codeRef: CodeRef }
): Selections {
  return {
    graphSelections: [
      {
        codeRef: artifact.codeRef,
        artifact,
      },
    ],
    otherSelections: [],
  }
}

async function getAstAndSketchSelections(code: string) {
  const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
  const artifact = artifactGraph.values().find((a) => a.type === 'path')
  if (!artifact) {
    throw new Error('Artifact not found in the graph')
  }
  const sketches = createSelectionFromPathArtifact(artifact)
  return { ast, sketches }
}

async function getKclCommandValue(value: string) {
  const result = await stringToKclExpression(value)
  if (err(result) || 'errors' in result) {
    throw new Error(`Couldn't create kcl expression`)
  }

  return result
}

describe('Testing addExtrude', () => {
  it('should push an extrude call in pipe if selection was in variable-less pipe', async () => {
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
  })

  it('should push a variable extrude call if selection was in variable profile', async () => {
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
  })

  it('should push an extrude call with variable if selection was in variable pipe', async () => {
    const code = `profile001 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
`
    const { ast, sketches } = await getAstAndSketchSelections(code)
    const length = await getKclCommandValue('3')
    const result = addExtrude({ ast, sketches, length })
    if (err(result)) throw result
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`extrude001 = extrude(profile001, length = 3)`)
  })

  it('should push an extrude call with all optional args if asked', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
`
    const { ast, sketches } = await getAstAndSketchSelections(code)
    const length = await getKclCommandValue('10')
    const symmetric = true
    const bidirectionalLength = await getKclCommandValue('20')
    const twistAngle = await getKclCommandValue('30')
    const result = addExtrude({
      ast,
      sketches,
      length,
      symmetric,
      bidirectionalLength,
      twistAngle,
    })
    if (err(result)) throw result
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`extrude001 = extrude(
  profile001,
  length = 10,
  symmetric = true,
  bidirectionalLength = 20,
  twistAngle = 30,
)`)
  })

  // TODO: missing edit flow test

  // TODO: missing multi-profile test
})

describe('Testing addSweep', () => {
  it('should push a sweep call with all optional args if asked', async () => {
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

    const sketches = createSelectionFromPathArtifact(artifact1)
    const path = createSelectionFromPathArtifact(artifact2)
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
