import {
  type Artifact,
  type ArtifactGraph,
  type PlaneArtifact,
  assertParse,
  recast,
} from '@src/lang/wasm'
import type { Selection, Selections } from '@src/lib/selections'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import {
  addOffsetPlane,
  addShell,
  retrieveFaceSelectionsFromOpArgs,
  retrieveNonDefaultPlaneSelectionFromOpArg,
} from '@src/lang/modifyAst/faces'
import { initPromise } from '@src/lang/wasmUtils'
import {
  engineCommandManager,
  kclManager,
  rustContext,
} from '@src/lib/singletons'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { KclCommandValue } from '@src/lib/commandTypes'
import env from '@src/env'
import type { DefaultPlaneStr } from '@src/lib/planes'
import type { StdLibCallOp } from '@src/lang/queryAst'

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

const boxWithTwoTags = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10, tag = $seg02)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10)`

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
    const { artifactGraph, ast } = await getAstAndArtifactGraph(cylinder)
    const faces = getCapFromCylinder(artifactGraph)
    const thickness = (await stringToKclExpression('1')) as KclCommandValue
    const result = addShell({ ast, artifactGraph, faces, thickness })
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
    const { artifactGraph, ast } = await getAstAndArtifactGraph(code)
    const faces = getCapFromCylinder(artifactGraph)
    const thickness = (await stringToKclExpression('1')) as KclCommandValue
    const result = addShell({ ast, artifactGraph, faces, thickness })
    if (err(result)) {
      throw result
    }

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(`${code}
  |> shell(faces = END, thickness = 1)`)
    await enginelessExecutor(ast)
  })

  it('should edit a basic shell call on cylinder end cap with new thickness', async () => {
    const code = `${cylinder}
shell001 = shell(extrude001, faces = END, thickness = 1)
`
    const { artifactGraph, ast } = await getAstAndArtifactGraph(code)
    const faces = getCapFromCylinder(artifactGraph)
    const thickness = (await stringToKclExpression('2')) as KclCommandValue
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

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(cylinder)
    expect(newCode).toContain(
      `shell001 = shell(extrude001, faces = END, thickness = 2)`
    )
    await enginelessExecutor(ast)
  })

  it('should add a shell call on box for 2 walls', async () => {
    const { artifactGraph, ast } = await getAstAndArtifactGraph(box)
    const faces = getFacesFromBox(artifactGraph, 2)
    const thickness = (await stringToKclExpression('1')) as KclCommandValue
    const result = addShell({ ast, artifactGraph, faces, thickness })
    if (err(result)) {
      throw result
    }

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(`${boxWithTwoTags}
shell001 = shell(extrude001, faces = [seg01, seg02], thickness = 1)`)
    await enginelessExecutor(ast)
  })

  it('should edit a shell call on box for 2 walls to a new thickness', async () => {
    const { artifactGraph, ast } =
      await getAstAndArtifactGraph(`${boxWithTwoTags}
shell001 = shell(extrude001, faces = [seg01, seg02], thickness = 1)`)
    const faces = getFacesFromBox(artifactGraph, 2)
    const thickness = (await stringToKclExpression('2')) as KclCommandValue
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

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(`${boxWithTwoTags}
shell001 = shell(extrude001, faces = [seg01, seg02], thickness = 2)`)
    await enginelessExecutor(ast)
  })

  it('should add a shell on two related sweeps end faces', async () => {
    // Code from https://github.com/KittyCAD/modeling-app/blob/21f11c369e1e4bcb6d2514d1150ba5e13138fe32/docs/kcl-std/functions/std-solid-shell.md#L154-L155
    const { ast, artifactGraph } = await getAstAndArtifactGraph(multiSolids)
    const twoCaps = [...artifactGraph.values()]
      .filter((a) => a.type === 'cap' && a.subType === 'end')
      .slice(0, 2)
      .reverse()
    const faces = createSelectionFromArtifacts(twoCaps, artifactGraph)
    const thickness = (await stringToKclExpression('5')) as KclCommandValue
    const result = addShell({ ast, artifactGraph, faces, thickness })
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
    const { artifactGraph, operations } = await getAstAndArtifactGraph(code)
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
    const { artifactGraph, operations } = await getAstAndArtifactGraph(code)
    const op = operations.find(
      (o) => o.type === 'StdLibCall' && o.name === 'offsetPlane'
    ) as StdLibCallOp
    const selections = retrieveNonDefaultPlaneSelectionFromOpArg(
      op.unlabeledArg!,
      artifactGraph
    )
    // TODO: this is what we hit at the moment for sweep face offsets
    // see https://github.com/KittyCAD/modeling-app/issues/7883
    if (err(selections)) throw selections
    expect(selections.graphSelections).toHaveLength(1)
    expect(selections.graphSelections[0].artifact!.type).toEqual('plane')
    // expect(
    //   (selections.graphSelections[0].artifact as PlaneArtifact).codeRef
    //     .pathToNode[1][0]
    // ).toEqual(0)
  })
})

describe('Testing addOffsetPlane', () => {
  it.each<DefaultPlaneStr>(['XY', 'XZ', 'YZ'])(
    'should add a basic offset plane call on default plane %s and then edit it',
    async (name) => {
      const { artifactGraph, ast, variables } = await getAstAndArtifactGraph('')
      const offset = (await stringToKclExpression('1')) as KclCommandValue
      const id = rustContext.getDefaultPlaneId(name)
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

      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(`plane001 = offsetPlane(${name}, offset = 1)`)
      await enginelessExecutor(ast)

      const newOffset = (await stringToKclExpression('2')) as KclCommandValue
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
      const newCode2 = recast(result2.modifiedAst)
      expect(newCode2).not.toContain(`offset = 1`)
      expect(newCode2).toContain(`plane001 = offsetPlane(${name}, offset = 2)`)
      await enginelessExecutor(result2.modifiedAst)
    }
  )

  it('should add an offset plane call on offset plane and then edit it', async () => {
    const code = `plane001 = offsetPlane(XY, offset = 1)`
    const { artifactGraph, ast, variables } = await getAstAndArtifactGraph(code)
    const offset = (await stringToKclExpression('2')) as KclCommandValue
    const artifact = [...artifactGraph.values()].find((a) => a.type === 'plane')
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

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(`${code}
plane002 = offsetPlane(plane001, offset = 2)`)
    await enginelessExecutor(ast)

    const newOffset = (await stringToKclExpression('3')) as KclCommandValue
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
    const newCode2 = recast(result2.modifiedAst)
    expect(newCode2).not.toContain(`offset = 2`)
    expect(newCode2).toContain(`${code}
plane002 = offsetPlane(plane001, offset = 3)`)
    await enginelessExecutor(result2.modifiedAst)
  })

  it('should add an offset plane call on cylinder end cap and allow edits', async () => {
    const { artifactGraph, ast, variables } =
      await getAstAndArtifactGraph(cylinder)
    const plane = getCapFromCylinder(artifactGraph)
    const offset = (await stringToKclExpression('2')) as KclCommandValue
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

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(`${cylinder}
plane001 = offsetPlane(planeOf(extrude001, face = END), offset = 2)`)
    await enginelessExecutor(ast)

    const newOffset = (await stringToKclExpression('3')) as KclCommandValue
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
    const newCode2 = recast(result2.modifiedAst)
    expect(newCode2).not.toContain(`offset = 2`)
    expect(newCode2).toContain(`${cylinder}
plane001 = offsetPlane(planeOf(extrude001, face = END), offset = 3)`)
    await enginelessExecutor(result2.modifiedAst)
  })

  it('should add an offset plane call on box wall and allow edits', async () => {
    const { artifactGraph, ast, variables } = await getAstAndArtifactGraph(box)
    const plane = getFacesFromBox(artifactGraph, 1)
    const offset = (await stringToKclExpression('10')) as KclCommandValue
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

    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(`${boxWithOneTag}
plane001 = offsetPlane(planeOf(extrude001, face = seg01), offset = 10)`)
    await enginelessExecutor(ast)

    const newOffset = (await stringToKclExpression('20')) as KclCommandValue
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
    const newCode2 = recast(result2.modifiedAst)
    expect(newCode2).not.toContain(`offset = 10`)
    expect(newCode2).toContain(`${boxWithOneTag}
plane001 = offsetPlane(planeOf(extrude001, face = seg01), offset = 20)`)
    await enginelessExecutor(result2.modifiedAst)
  })
})
