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
import type { ConnectionManager } from '@src/network/connectionManager'
import { afterAll, expect } from 'vitest'

let instanceInThisFile: ModuleType = null!
let engineCommandManagerInThisFile: ConnectionManager = null!
let rustContextInThisFile: RustContext = null!

/**
 * Every it test could build the world and connect to the engine but this is too resource intensive and will
 * spam engine connections.
 *
 * Reuse the world for this file. This is not the same as global singleton imports!
 */
beforeEach(async () => {
  if (instanceInThisFile) {
    return
  }

  const { instance, engineCommandManager, rustContext } =
    await buildTheWorldAndConnectToEngine()
  instanceInThisFile = instance
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})
afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
})

async function getAstAndArtifactGraph(
  code: string,
  instance: ModuleType,
  rustContext: RustContext
) {
  const ast = assertParse(code, instanceInThisFile)
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
      const expectedNewLine = `helix001 = helix(
  axis = X,
  revolutions = 1,
  angleStart = 2,
  radius = 3,
  length = 4,
)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        '',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addHelix({
        ast,
        artifactGraph,
        axis: 'X',
        revolutions: (await stringToKclExpression(
          '1',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '2',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '3',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        length: (await stringToKclExpression(
          '4',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
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
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        '',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addHelix({
        ast,
        artifactGraph,
        axis: 'X',
        revolutions: (await stringToKclExpression(
          '1',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '2',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '3',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        length: (await stringToKclExpression(
          '4',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        ccw: true,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
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
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addHelix({
        ast,
        artifactGraph,
        axis: 'Y',
        revolutions: (await stringToKclExpression(
          '11',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '12',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '13',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        length: (await stringToKclExpression(
          '14',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        nodeToEdit: createPathToNodeForLastVariable(ast),
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
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
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        segmentInPath,
        instanceInThisFile,
        rustContextInThisFile
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
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '2',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '3',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toBe(helixFromSegmentInPath)
    })

    it('should edit a standalone call on segment selection', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        helixFromSegmentInPath,
        instanceInThisFile,
        rustContextInThisFile
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
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '5',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '6',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        ccw: true,
        nodeToEdit: createPathToNodeForLastVariable(ast),
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
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
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        cylinderExtrude,
        instanceInThisFile,
        rustContextInThisFile
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
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '2',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        ccw: true,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toBe(helixFromCylinder)
    })

    it('should edit a standalone call on cylinder selection', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        helixFromCylinder,
        instanceInThisFile,
        rustContextInThisFile
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
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '22',
          undefined,
          instanceInThisFile,
          rustContextInThisFile
        )) as KclCommandValue,
        ccw: false,
        nodeToEdit: createPathToNodeForLastVariable(ast),
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, undefined, undefined, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `helix001 = helix(cylinder = extrude001, revolutions = 11, angleStart = 22`
      )
    })
  })
})
