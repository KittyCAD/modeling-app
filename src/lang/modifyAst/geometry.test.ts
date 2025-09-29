import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { addHelix } from '@src/lang/modifyAst/geometry'
import { assertParse, recast } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'

async function getAstAndArtifactGraph(code: string) {
  const ast = assertParse(code)
  if (err(ast)) throw ast

  const { artifactGraph } = await enginelessExecutor(ast)
  return { ast, artifactGraph }
}

describe('Testing addHelix', () => {
  it('should add a standalone call on default axis selection', async () => {
    const expectedNewLine = `helix001 = helix(
  axis = X,
  revolutions = 1,
  angleStart = 2,
  radius = 3,
  length = 4,
)`
    const { ast, artifactGraph } = await getAstAndArtifactGraph('')
    const result = addHelix({
      ast,
      artifactGraph,
      axis: 'X',
      revolutions: (await stringToKclExpression('1')) as KclCommandValue,
      angleStart: (await stringToKclExpression('2')) as KclCommandValue,
      radius: (await stringToKclExpression('3')) as KclCommandValue,
      length: (await stringToKclExpression('4')) as KclCommandValue,
    })
    if (err(result)) throw result
    await enginelessExecutor(ast)
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(expectedNewLine)
  })

  it('should add a standalone call on default axis selection with ccw true', async () => {
    const expectedNewLine = `helix001 = helix(
  axis = X,
  revolutions = 1,
  angleStart = 2,
  radius = 3,
  length = 4,
  ccw = true,
)`
    const { ast, artifactGraph } = await getAstAndArtifactGraph('')
    const result = addHelix({
      ast,
      artifactGraph,
      axis: 'X',
      revolutions: (await stringToKclExpression('1')) as KclCommandValue,
      angleStart: (await stringToKclExpression('2')) as KclCommandValue,
      radius: (await stringToKclExpression('3')) as KclCommandValue,
      length: (await stringToKclExpression('4')) as KclCommandValue,
      ccw: true,
    })
    if (err(result)) throw result
    await enginelessExecutor(ast)
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(expectedNewLine)
  })

  it('should edit a standalone call with default axis selection', async () => {
    const code = `helix001 = helix(
  axis = X,
  revolutions = 1,
  angleStart = 2,
  radius = 3,
  length = 4,
)`
    const expectedNewLine = `helix001 = helix(
  axis = Y,
  revolutions = 11,
  angleStart = 12,
  radius = 13,
  length = 14,
)`
    const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
    const result = addHelix({
      ast,
      artifactGraph,
      axis: 'Y',
      revolutions: (await stringToKclExpression('11')) as KclCommandValue,
      angleStart: (await stringToKclExpression('12')) as KclCommandValue,
      radius: (await stringToKclExpression('13')) as KclCommandValue,
      length: (await stringToKclExpression('14')) as KclCommandValue,
      nodeToEdit: createPathToNodeForLastVariable(ast),
    })
    if (err(result)) throw result
    await enginelessExecutor(ast)
    const newCode = recast(result.modifiedAst)
    expect(newCode).not.toContain(code)
    expect(newCode).toContain(expectedNewLine)
  })

  const segmentInPath = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = 100)
  |> line(endAbsolute = [100, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`

  const helixFromSegmentInPath = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = 100, tag = $seg01)
  |> line(endAbsolute = [100, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
helix001 = helix(
  axis = seg01,
  revolutions = 1,
  angleStart = 2,
  radius = 3,
)
`

  it('should add a standalone call on segment selection', async () => {
    const { ast, artifactGraph } = await getAstAndArtifactGraph(segmentInPath)
    const segment = [...artifactGraph.values()].find(
      (n) => n.type === 'segment'
    )
    const edge: Selections = {
      graphSelections: [
        {
          artifact: segment,
          codeRef: segment!.codeRef,
        },
      ],
      otherSelections: [],
    }
    const result = addHelix({
      ast,
      artifactGraph,
      edge,
      revolutions: (await stringToKclExpression('1')) as KclCommandValue,
      angleStart: (await stringToKclExpression('2')) as KclCommandValue,
      radius: (await stringToKclExpression('3')) as KclCommandValue,
    })
    if (err(result)) throw result
    await enginelessExecutor(ast)
    const newCode = recast(result.modifiedAst)
    expect(newCode).toBe(helixFromSegmentInPath)
  })

  it('should edit a standalone call on segment selection', async () => {
    const { ast, artifactGraph } = await getAstAndArtifactGraph(
      helixFromSegmentInPath
    )
    const segment = [...artifactGraph.values()].find(
      (n) => n.type === 'segment'
    )
    const edge: Selections = {
      graphSelections: [
        {
          artifact: segment,
          codeRef: segment!.codeRef,
        },
      ],
      otherSelections: [],
    }
    const result = addHelix({
      ast,
      artifactGraph,
      edge,
      revolutions: (await stringToKclExpression('4')) as KclCommandValue,
      angleStart: (await stringToKclExpression('5')) as KclCommandValue,
      radius: (await stringToKclExpression('6')) as KclCommandValue,
      ccw: true,
      nodeToEdit: createPathToNodeForLastVariable(ast),
    })
    if (err(result)) throw result
    await enginelessExecutor(ast)
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(`helix001 = helix(
  axis = seg01,
  revolutions = 4,
  angleStart = 5,
  radius = 6,
  ccw = true,
)`)
  })

  // For now to avoid setting up an engine connection, the sweepEdge case is done in e2e (point-click.spec.ts)

  const cylinderExtrude = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 100)
extrude001 = extrude(profile001, length = 100)`

  const helixFromCylinder = `${cylinderExtrude}
helix001 = helix(
  cylinder = extrude001,
  revolutions = 1,
  angleStart = 2,
  ccw = true,
)
`

  it('should add a standalone call on cylinder selection', async () => {
    const { ast, artifactGraph } = await getAstAndArtifactGraph(cylinderExtrude)
    const sweep = [...artifactGraph.values()].find((n) => n.type === 'sweep')
    const cylinder: Selections = {
      graphSelections: [
        {
          artifact: sweep,
          codeRef: sweep!.codeRef,
        },
      ],
      otherSelections: [],
    }
    const result = addHelix({
      ast,
      artifactGraph,
      cylinder,
      revolutions: (await stringToKclExpression('1')) as KclCommandValue,
      angleStart: (await stringToKclExpression('2')) as KclCommandValue,
      ccw: true,
    })
    if (err(result)) throw result
    await enginelessExecutor(ast)
    const newCode = recast(result.modifiedAst)
    expect(newCode).toBe(helixFromCylinder)
  })

  it('should edit a standalone call on cylinder selection', async () => {
    const { ast, artifactGraph } =
      await getAstAndArtifactGraph(helixFromCylinder)
    const sweep = [...artifactGraph.values()].find((n) => n.type === 'sweep')
    const cylinder: Selections = {
      graphSelections: [
        {
          artifact: sweep,
          codeRef: sweep!.codeRef,
        },
      ],
      otherSelections: [],
    }
    const result = addHelix({
      ast,
      artifactGraph,
      cylinder,
      revolutions: (await stringToKclExpression('11')) as KclCommandValue,
      angleStart: (await stringToKclExpression('22')) as KclCommandValue,
      ccw: false,
      nodeToEdit: createPathToNodeForLastVariable(ast),
    })
    if (err(result)) throw result
    await enginelessExecutor(ast)
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(
      `helix001 = helix(cylinder = extrude001, revolutions = 11, angleStart = 22`
    )
  })
})
