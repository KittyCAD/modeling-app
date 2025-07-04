import {
  type Artifact,
  assertParse,
  type CodeRef,
  recast,
} from '@src/lang/wasm'
import type { Selection, Selections } from '@src/lib/selections'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { addShell } from '@src/lang/modifyAst/faces'
import { stringToKclExpression } from '@src/lib/kclHelpers'

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
  return { artifactGraph, ast, sketches }
}

async function getKclCommandValue(value: string) {
  const result = await stringToKclExpression(value)
  if (err(result) || 'errors' in result) {
    throw new Error(`Couldn't create kcl expression`)
  }

  return result
}

describe('Testing addShell', () => {
  it('should push a call in pipe if selection was in variable-less pipe', async () => {
    const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 10)
  |> extrude(length = 10)
`
    const {
      artifactGraph,
      ast,
      sketches: solids,
    } = await getAstAndSketchSelections(code)
    console.log('artifactGraph', artifactGraph)
    const thickness = await getKclCommandValue('1')
    const faces: Selections = {
      graphSelections: [],
      otherSelections: [],
    }
    const result = addShell({ ast, artifactGraph, solids, faces, thickness })
    if (err(result)) throw result
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`|> shell(faces = [END], thickness = 1)`)
    await enginelessExecutor(ast)
  })

  //   it('should push a call with variable if selection was in variable profile', async () => {
  //     const code = `sketch001 = startSketchOn(XY)
  // profile001 = circle(sketch001, center = [0, 0], radius = 1)
  // `
  //     const { ast, sketches } = await getAstAndSketchSelections(code)
  //     const length = await getKclCommandValue('2')
  //     const result = addExtrude({ ast, sketches, length })
  //     if (err(result)) throw result
  //     const newCode = recast(result.modifiedAst)
  //     expect(newCode).toContain(code)
  //     expect(newCode).toContain(`extrude001 = extrude(profile001, length = 2)`)
  //     await runNewAstAndCheckForSweep(result.modifiedAst)
  //   })

  // TODO: missing edit flow test

  // TODO: missing multi-profile test
})
