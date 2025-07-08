import {
  type Artifact,
  type ArtifactGraph,
  assertParse,
  recast,
} from '@src/lang/wasm'
import type { Selection, Selections } from '@src/lib/selections'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { addShell } from '@src/lang/modifyAst/faces'
import { initPromise } from '@src/lang/wasmUtils'
import { engineCommandManager, kclManager } from '@src/lib/singletons'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import {
  engineCommandManagerStartPromise,
  getKclCommandValue,
} from '@src/lang/modifyAst/utils.test'

// Unfortunately, we need the real engine here it seems to get sweep faces populated
beforeAll(async () => {
  await initPromise
  await engineCommandManagerStartPromise
}, 30_000)

afterAll(() => {
  engineCommandManager.tearDown()
})

async function getAstAndArtifactGraph(code: string) {
  const ast = assertParse(code)
  if (err(ast)) throw ast
  await kclManager.executeAst({ ast })
  const artifactGraph = kclManager.artifactGraph

  expect(kclManager.errors).toEqual([])
  return { ast, artifactGraph }
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

async function getAstAndSolidSelections(code: string) {
  const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
  const artifacts = [...artifactGraph.values()].filter((a) => a.type === 'path')
  if (artifacts.length === 0) {
    throw new Error('Artifact not found in the graph')
  }
  const solids = createSelectionFromArtifacts(artifacts, artifactGraph)
  return { artifactGraph, ast, solids }
}

describe('Testing addShell', () => {
  it('should add a basic shell call on cylinder end cap', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 10)
extrude001 = extrude(profile001, length = 10)
`
    const { artifactGraph, ast, solids } = await getAstAndSolidSelections(code)
    const endFace = [...artifactGraph.values()].find(
      (a) => a.type === 'cap' && a.subType === 'end'
    )
    if (!endFace) throw new Error('End face not found in the artifact graph')
    const faces = createSelectionFromArtifacts([endFace], artifactGraph)
    const thickness = await getKclCommandValue('1')
    const result = addShell({ ast, artifactGraph, solids, faces, thickness })
    if (err(result)) {
      throw result
    }

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(
      `shell001 = shell(extrude001, faces = END, thickness = 1)`
    )
    await enginelessExecutor(ast)
  })

  it('should add a shell call on box for 2 walls', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10)
`
    const { artifactGraph, ast, solids } = await getAstAndSolidSelections(code)
    const twoWalls = [...artifactGraph.values()]
      .filter((a) => a.type === 'wall')
      .slice(0, 2)
    const faces = createSelectionFromArtifacts(twoWalls, artifactGraph)
    const thickness = await getKclCommandValue('1')
    const result = addShell({ ast, artifactGraph, solids, faces, thickness })
    if (err(result)) {
      throw result
    }

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(`
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10, tag = $seg02)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10)
shell001 = shell(extrude001, faces = [seg01, seg02], thickness = 1)
`)
    await enginelessExecutor(ast)
  })

  it('should add a shell on two related sweeps end faces', async () => {
    // Code from https://github.com/KittyCAD/modeling-app/blob/21f11c369e1e4bcb6d2514d1150ba5e13138fe32/docs/kcl-std/functions/std-solid-shell.md#L154-L155
    const code = `size = 100
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
    const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
    const lastTwoSweeps = [...artifactGraph.values()]
      .filter((a) => a.type === 'sweep')
      .slice(-2)
    const solids = createSelectionFromArtifacts(lastTwoSweeps, artifactGraph)
    const twoCaps = [...artifactGraph.values()]
      .filter((a) => a.type === 'cap' && a.subType === 'end')
      .slice(0, 2)
    const faces = createSelectionFromArtifacts(twoCaps, artifactGraph)
    const thickness = await getKclCommandValue('5')
    const result = addShell({ ast, artifactGraph, solids, faces, thickness })
    if (err(result)) {
      throw result
    }

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`
shell001 = shell([thing1, thing2], faces = [END, END], thickness = 5)
`)
    await enginelessExecutor(ast)
  })

  // TODO: missing edit flow test
})
