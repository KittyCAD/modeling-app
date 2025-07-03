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
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { addTranslate } from '@src/lang/modifyAst/transforms'

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

async function runNewAstAndCheckForSweep(ast: Node<Program>) {
  const { artifactGraph } = await enginelessExecutor(ast)
  console.log('artifactGraph', artifactGraph)
  const sweepArtifact = artifactGraph.values().find((a) => a.type === 'sweep')
  expect(sweepArtifact).toBeDefined()
}

describe('Testing addTranslate', () => {
  it('should push a call with variable if selection was a variable sweep', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
`
    const {
      artifactGraph,
      ast,
      sketches: objects,
    } = await getAstAndSketchSelections(code)
    const result = addTranslate({
      ast,
      artifactGraph,
      objects,
      x: await getKclCommandValue('1'),
      y: await getKclCommandValue('2'),
      z: await getKclCommandValue('3'),
      global: true,
    })
    if (err(result)) throw result
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`translate001 = translate(
  extrude001,
  x = 1,
  y = 2,
  z = 3,
  global = true,
)`)
    await runNewAstAndCheckForSweep(result.modifiedAst)
  })

  it('should push a call in pipe if selection was in variable-less pipe', async () => {
    const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
`
    const {
      artifactGraph,
      ast,
      sketches: objects,
    } = await getAstAndSketchSelections(code)
    const result = addTranslate({
      ast,
      artifactGraph,
      objects,
      x: await getKclCommandValue('1'),
      y: await getKclCommandValue('2'),
      z: await getKclCommandValue('3'),
    })
    if (err(result)) throw result
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`|> translate(x = 1, y = 2, z = 3)`)
    await runNewAstAndCheckForSweep(result.modifiedAst)
  })

  // TODO: missing edit flow test

  // TODO: missing multi-objects test
})
