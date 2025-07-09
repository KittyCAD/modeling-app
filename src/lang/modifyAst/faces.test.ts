import {
  type Artifact,
  type ArtifactGraph,
  assertParse,
  recast,
} from '@src/lang/wasm'
import type { Selection, Selections } from '@src/lib/selections'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import {
  addShell,
  retrieveFaceSelectionsFromOpArgs,
} from '@src/lang/modifyAst/faces'
import { initPromise } from '@src/lang/wasmUtils'
import { engineCommandManager, kclManager } from '@src/lib/singletons'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { KclCommandValue } from '@src/lib/commandTypes'
import env from '@src/env'

// Unfortunately, we need the real engine here it seems to get sweep faces populated
beforeAll(async () => {
  await initPromise
  await new Promise((resolve) => {
    engineCommandManager.start({
      token: env().VITE_KITTYCAD_API_TOKEN,
      width: 256,
      height: 256,
      setMediaStream: () => {},
      setIsStreamReady: () => {},
      callbackOnEngineLiteConnect: () => {
        resolve(true)
      },
    })
  })
}, 30_000)

afterAll(() => {
  engineCommandManager.tearDown()
})

async function getAstAndArtifactGraph(code: string) {
  const ast = assertParse(code)
  await kclManager.executeAst({ ast })
  const {
    artifactGraph,
    execState: { operations },
  } = kclManager
  await new Promise((resolve) => setTimeout(resolve, 100))
  return { ast, artifactGraph, operations }
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

describe('Testing addShell', () => {
  const cylinder = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 10)
extrude001 = extrude(profile001, length = 10)`

  function getCapFromCylinder(artifactGraph: ArtifactGraph) {
    const endFace = [...artifactGraph.values()].find(
      (a) => a.type === 'cap' && a.subType === 'end'
    )
    return createSelectionFromArtifacts([endFace!], artifactGraph)
  }

  it('should add a basic shell call on cylinder end cap', async () => {
    const { artifactGraph, ast, solids } =
      await getAstAndSolidSelections(cylinder)
    const faces = getCapFromCylinder(artifactGraph)
    const thickness = (await stringToKclExpression('1')) as KclCommandValue
    const result = addShell({ ast, artifactGraph, solids, faces, thickness })
    if (err(result)) {
      throw result
    }

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(cylinder)
    expect(newCode).toContain(
      `shell001 = shell(extrude001, faces = END, thickness = 1)`
    )
    await enginelessExecutor(ast)
  })

  it('should edit a basic shell call on cylinder end cap with new thickness', async () => {
    const code = `${cylinder}
shell001 = shell(extrude001, faces = END, thickness = 1)
`
    const { artifactGraph, ast, solids } = await getAstAndSolidSelections(code)
    const faces = getCapFromCylinder(artifactGraph)
    const thickness = (await stringToKclExpression('2')) as KclCommandValue
    const nodeToEdit = createPathToNodeForLastVariable(ast)
    const result = addShell({
      ast,
      artifactGraph,
      solids,
      faces,
      thickness,
      nodeToEdit,
    })
    if (err(result)) {
      throw result
    }

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(cylinder)
    expect(newCode).toContain(
      `shell001 = shell(extrude001, faces = END, thickness = 2)`
    )
    await enginelessExecutor(ast)
  })

  const box = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10)
`
  const boxWithTwoTags = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10, tag = $seg02)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10)`

  function getTwoFacesFromBox(artifactGraph: ArtifactGraph) {
    const twoWalls = [...artifactGraph.values()]
      .filter((a) => a.type === 'wall')
      .slice(0, 2)
    return createSelectionFromArtifacts(twoWalls, artifactGraph)
  }

  it('should add a shell call on box for 2 walls', async () => {
    const { artifactGraph, ast, solids } = await getAstAndSolidSelections(box)
    const faces = getTwoFacesFromBox(artifactGraph)
    const thickness = (await stringToKclExpression('1')) as KclCommandValue
    const result = addShell({ ast, artifactGraph, solids, faces, thickness })
    if (err(result)) {
      throw result
    }

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(`${boxWithTwoTags}
shell001 = shell(extrude001, faces = [seg01, seg02], thickness = 1)`)
    await enginelessExecutor(ast)
  })

  it('should edit a shell call on box for 2 walls to a new thickness', async () => {
    const { artifactGraph, ast, solids } =
      await getAstAndSolidSelections(`${boxWithTwoTags}
shell001 = shell(extrude001, faces = [seg01, seg02], thickness = 1)`)
    const faces = getTwoFacesFromBox(artifactGraph)
    const thickness = (await stringToKclExpression('2')) as KclCommandValue
    const nodeToEdit = createPathToNodeForLastVariable(ast)
    const result = addShell({
      ast,
      artifactGraph,
      solids,
      faces,
      thickness,
      nodeToEdit,
    })
    if (err(result)) {
      throw result
    }

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(`${boxWithTwoTags}
shell001 = shell(extrude001, faces = [seg01, seg02], thickness = 2)`)
    await enginelessExecutor(ast)
  })

  it('should add a shell on two related sweeps end faces', async () => {
    // Code from https://github.com/KittyCAD/modeling-app/blob/21f11c369e1e4bcb6d2514d1150ba5e13138fe32/docs/kcl-std/functions/std-solid-shell.md#L154-L155
    const { ast, artifactGraph } = await getAstAndArtifactGraph(multiSolids)
    const lastTwoSweeps = [...artifactGraph.values()]
      .filter((a) => a.type === 'sweep')
      .slice(-2)
    const solids = createSelectionFromArtifacts(lastTwoSweeps, artifactGraph)
    const twoCaps = [...artifactGraph.values()]
      .filter((a) => a.type === 'cap' && a.subType === 'end')
      .slice(0, 2)
    const faces = createSelectionFromArtifacts(twoCaps, artifactGraph)
    const thickness = (await stringToKclExpression('5')) as KclCommandValue
    const result = addShell({ ast, artifactGraph, solids, faces, thickness })
    if (err(result)) {
      throw result
    }

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(multiSolidsShell)
    await enginelessExecutor(ast)
  })
})

describe('Testing retrieveFaceSelectionsFromOpArgs', () => {
  it('should find the solid and face of basic shell on cylinder cap', async () => {
    const circleProfileInVar = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
shell001 = shell(extrude001, faces = END, thickness = 0.1)
`
    const { artifactGraph, operations } =
      await getAstAndArtifactGraph(circleProfileInVar)
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

    console.log('Selections:', selections)
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
    const { artifactGraph, operations } =
      await getAstAndArtifactGraph(multiSolidsShell)
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
    expect(selections.faces.graphSelections).toHaveLength(2)
  })
})
