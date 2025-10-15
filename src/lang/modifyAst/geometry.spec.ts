import { assertParse, recast } from '@src/lang/wasm'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { addHelix } from '@src/lang/modifyAst/geometry'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import type RustContext from '@src/lib/rustContext'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

async function getAstAndArtifactGraph(
  code: string,
  instance: ModuleType,
  rustContext: RustContext
) {
  const ast = assertParse(code, instance)
  if (err(ast)) throw ast

  const { artifactGraph } = await enginelessExecutor(
    ast,
    undefined,
    undefined,
    rustContext
  )
  return { ast, artifactGraph }
}

describe('geometry.test.ts', () => {
  describe('Testing addHelix', () => {
    it('should add a standalone call on default axis selection', async () => {
      const { instance, rustContext } = await buildTheWorldAndConnectToEngine()
      const expectedNewLine = `helix001 = helix(
  axis = X,
  revolutions = 1,
  angleStart = 2,
  radius = 3,
  length = 4,
)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        '',
        instance,
        rustContext
      )
      const result = addHelix({
        ast,
        artifactGraph,
        axis: 'X',
        revolutions: (await stringToKclExpression(
          '1',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '2',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '3',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        length: (await stringToKclExpression(
          '4',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, undefined, undefined, rustContext)
      const newCode = recast(result.modifiedAst, instance)
      expect(newCode).toContain(expectedNewLine)
    })

    it('should add a standalone call on default axis selection with ccw true', async () => {
      const { instance, rustContext } = await buildTheWorldAndConnectToEngine()
      const expectedNewLine = `helix001 = helix(
  axis = X,
  revolutions = 1,
  angleStart = 2,
  radius = 3,
  length = 4,
  ccw = true,
)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        '',
        instance,
        rustContext
      )
      const result = addHelix({
        ast,
        artifactGraph,
        axis: 'X',
        revolutions: (await stringToKclExpression(
          '1',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '2',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '3',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        length: (await stringToKclExpression(
          '4',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        ccw: true,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, undefined, undefined, rustContext)
      const newCode = recast(result.modifiedAst, instance)
      expect(newCode).toContain(expectedNewLine)
    })

    it('should edit a standalone call with default axis selection', async () => {
      const { instance, rustContext } = await buildTheWorldAndConnectToEngine()
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
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instance,
        rustContext
      )
      const result = addHelix({
        ast,
        artifactGraph,
        axis: 'Y',
        revolutions: (await stringToKclExpression(
          '11',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '12',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '13',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        length: (await stringToKclExpression(
          '14',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        nodeToEdit: createPathToNodeForLastVariable(ast),
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, undefined, undefined, rustContext)
      const newCode = recast(result.modifiedAst, instance)
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
      const { instance, rustContext } = await buildTheWorldAndConnectToEngine()
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        segmentInPath,
        instance,
        rustContext
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
        revolutions: (await stringToKclExpression(
          '1',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '2',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '3',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, undefined, undefined, rustContext)
      const newCode = recast(result.modifiedAst, instance)
      expect(newCode).toBe(helixFromSegmentInPath)
    })

    it('should edit a standalone call on segment selection', async () => {
      const { instance, rustContext } = await buildTheWorldAndConnectToEngine()
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        helixFromSegmentInPath,
        instance,
        rustContext
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
        revolutions: (await stringToKclExpression(
          '4',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '5',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '6',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        ccw: true,
        nodeToEdit: createPathToNodeForLastVariable(ast),
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, undefined, undefined, rustContext)
      const newCode = recast(result.modifiedAst, instance)
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
      const { instance, rustContext } = await buildTheWorldAndConnectToEngine()
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        cylinderExtrude,
        instance,
        rustContext
      )
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
        revolutions: (await stringToKclExpression(
          '1',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '2',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        ccw: true,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, undefined, undefined, rustContext)
      const newCode = recast(result.modifiedAst, instance)
      expect(newCode).toBe(helixFromCylinder)
    })

    it('should edit a standalone call on cylinder selection', async () => {
      const { instance, rustContext } = await buildTheWorldAndConnectToEngine()
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        helixFromCylinder,
        instance,
        rustContext
      )
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
        revolutions: (await stringToKclExpression(
          '11',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '22',
          undefined,
          instance,
          rustContext
        )) as KclCommandValue,
        ccw: false,
        nodeToEdit: createPathToNodeForLastVariable(ast),
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, undefined, undefined, rustContext)
      const newCode = recast(result.modifiedAst, instance)
      expect(newCode).toContain(
        `helix001 = helix(cylinder = extrude001, revolutions = 11, angleStart = 22`
      )
    })
  })
})
