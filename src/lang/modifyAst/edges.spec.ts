import type { KclManager } from '@src/lang/KclManager'
import { createLocalName, createVariableDeclaration } from '@src/lang/create'
import {
  EdgeTreatmentType,
  addBlend,
  addChamfer,
  addFillet,
  deleteEdgeTreatment,
  retrieveEdgeSelectionsFromOpArgs,
  retrieveEdgeSelectionsFromSingleEdgeRef,
} from '@src/lang/modifyAst/edges'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { ResolvedGraphSelection } from '@src/lang/std/artifactGraph'
import {
  codeRefFromRange,
  getCodeRefsByArtifactId,
  getCommonFacesForEdge,
} from '@src/lang/std/artifactGraph'
import { topLevelRange } from '@src/lang/util'
import { assertParse, getAllOperations, recast } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import {
  createSelectionFromArtifacts,
  enginelessExecutor,
  getAstAndArtifactGraph,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { isOverlap } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  NonCodeSelection,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
let kclManagerInThisFile: KclManager = null!
let rustContextInThisFile: RustContext = null!
let engineCommandManagerInThisFile: ConnectionManager = null!

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

  const { instance, kclManager, engineCommandManager, rustContext } =
    await buildTheWorldAndConnectToEngine()
  instanceInThisFile = instance
  kclManagerInThisFile = kclManager
  rustContextInThisFile = rustContext
  engineCommandManagerInThisFile = engineCommandManager
})
afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
})

describe('edges.spec.ts', () => {
  const extrudedTriangle = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5)`
  const _extrudedTriangleWithFillet = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
fillet001 = fillet(extrude001, tags = getCommonEdge(faces = [seg01, capEnd001]), radius = 1)`
  const _extrudedTriangleWithChamfer = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
chamfer001 = chamfer(extrude001, tags = getCommonEdge(faces = [seg01, capEnd001]), length = 1)`
  const _twoExtrudedTriangles = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5)
  |> yLine(length = 5)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5)

sketch002 = startSketchOn(XY)
profile002 = startProfile(sketch002, at = [10, 0])
  |> xLine(length = 5)
  |> yLine(length = 5)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(profile002, length = 5)`
  const _revolvedCShapeWithRectangularProfile = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 1])
  |> yLine(length = 3)
  |> xLine(length = 4)
  |> yLine(length = -3)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(profile001, angle = 270deg, axis = X)`
  const twoSurfacesForBlend = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 0])
  |> angledLine(angle = 0deg, length = 4)
  |> extrude(length = 2, bodyType = SURFACE)
  |> translate(y = 3, z = 2)

sketch002 = startSketchOn(XZ)
profile002 = startProfile(sketch002, at = [-1, 0])
  |> angledLine(angle = 0deg, length = 2)
  |> extrude(length = 2, bodyType = SURFACE)
  |> flipSurface()`
  const sketchSolveSurfacesForBlend = `@settings(experimentalFeatures = allow)

sketch001 = sketch(on = XY) {
  line1 = line(start = [var -9.76mm, var 1.02mm], end = [var -4.06mm, var 5.49mm])
}
extrude001 = extrude(sketch001.line1, length = 5, bodyType = SURFACE)
sketch002 = sketch(on = XY) {
  line1 = line(start = [var -13.52mm, var 5.92mm], end = [var -6.48mm, var 9.82mm])
}
extrude002 = extrude(sketch002.line1, length = 5, bodyType = SURFACE)
hidden001 = hide(sketch002)
hidden002 = hide(sketch001)`
  // SelectionV2 / Face API: sweepEdge was removed from the artifact graph. Edge selection is now
  // segment (or edgeCut for chamfer/fillet face). addFillet/addChamfer accept graphSelections
  // with entityRef.type === 'edge' (faces array). Tests that relied on sweepEdge are obsolete.
  // New coverage: addFillet/addChamfer with edge selection built from segment + getCommonFacesForEdge
  // (see "should add a basic fillet call with edge selection (selectionV2)" below).

  describe('Testing addFillet', () => {
    it('should insert a new radius variable when editing a fillet with edge references', async () => {
      const call =
        'fillet(solid001, edges = [{ sideFaces = [face001, face002] }], radius = 1)'
      const code = `solid001 = cube(size = 10)
fillet001 = ${call}`
      const ast = assertParse(code, instanceInThisFile)
      const callStart = code.indexOf(call)
      const nodeToEdit = getNodePathFromSourceRange(
        ast,
        topLevelRange(callStart, callStart + call.length)
      )
      const value = (await stringToKclExpression(
        '2',
        rustContextInThisFile
      )) as KclCommandValue

      const result = addFillet({
        ast,
        artifactGraph: new Map(),
        selection: { graphSelections: [], otherSelections: [] },
        radius: {
          ...value,
          variableName: 'radius001',
          variableDeclarationAst: createVariableDeclaration(
            'radius001',
            value.valueAst
          ),
          variableIdentifierAst: createLocalName('radius001'),
          insertIndex: 0,
        },
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain('radius001 = 2')
      expect(newCode).toContain('radius = radius001')
    })

    it('should add a fillet call using engine primitive edge indices', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweep = [...artifactGraph.values()].find((a) => a.type === 'sweep')
      expect(sweep).toBeDefined()

      const primitiveEdge: NonCodeSelection = {
        entityId: 'irrelevant-for-this-test',
        parentEntityId: sweep?.id,
        primitiveIndex: 2,
        primitiveType: 'edge',
        type: 'enginePrimitive',
      }
      const selection: Selections = {
        graphSelections: [],
        otherSelections: [primitiveEdge],
      }

      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `${extrudedTriangle}
edge001 = edgeId(extrude001, index = 2)
fillet001 = fillet(extrude001, tags = edge001, radius = 1)`
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a basic fillet call with edge selection (selectionV2)', async () => {
      const codeWithTags = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        codeWithTags,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const segment = [...artifactGraph.values()].find(
        (a): a is Extract<typeof a, { type: 'segment' }> => a.type === 'segment'
      )
      expect(segment).toBeDefined()
      if (!segment) return
      const commonFaces = getCommonFacesForEdge(segment, artifactGraph)
      if (err(commonFaces)) throw commonFaces
      expect(commonFaces.length).toBeGreaterThanOrEqual(2)
      const codeRefs = getCodeRefsByArtifactId(segment.id, artifactGraph)
      expect(codeRefs?.length).toBeGreaterThan(0)
      const selection: Selections = {
        graphSelections: [
          {
            entityRef: {
              type: 'edge',
              side_faces: commonFaces.slice(0, 2).map((f) => f.id),
            },
            codeRef: codeRefs![0],
          },
        ],
        otherSelections: [],
      }
      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain('fillet(')
      expect(newCode).toContain('radius = 1')
      expect(newCode).toMatch(/edges = \[\s*{/)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('qualifies an original body cap after the body is cloned', async () => {
      const code = `@settings(kclVersion = 2.0)
sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [20, 0])
  right = line(start = [20, 0], end = [20, 12])
  top = line(start = [20, 12], end = [0, 12])
  left = line(start = [0, 12], end = [0, 0])
}
region001 = region(point = [10, 6], sketch = sketch001)
body001 = extrude(region001, length = 8, tagEnd = $endCap)
body002 = clone(body001) |> translate(x = 30)
hide(sketch001)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const originalSweep = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweep' && !artifact.sourceSweepId
      )
      expect(originalSweep).toBeDefined()
      if (!originalSweep || originalSweep.type !== 'sweep') return
      const endCap = [...artifactGraph.values()].find(
        (artifact) =>
          artifact.type === 'cap' &&
          artifact.sweepId === originalSweep.id &&
          artifact.subType === 'end'
      )
      const wall = [...artifactGraph.values()].find(
        (artifact) =>
          artifact.type === 'wall' && artifact.sweepId === originalSweep.id
      )
      expect(endCap).toBeDefined()
      expect(wall).toBeDefined()
      if (!endCap || endCap.type !== 'cap' || !wall || wall.type !== 'wall')
        return
      const segment = artifactGraph.get(wall.segId)
      expect(segment).toBeDefined()
      if (!segment || segment.type !== 'segment') return
      const codeRefs = getCodeRefsByArtifactId(segment.id, artifactGraph)
      expect(codeRefs?.length).toBeGreaterThan(0)

      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection: {
          graphSelections: [
            {
              entityRef: {
                type: 'edge',
                side_faces: [endCap.id, wall.id],
              },
              codeRef: codeRefs![0],
            },
          ],
          otherSelections: [],
        },
        radius,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain('body001.faces.endCap')
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should resolve face API edges before inserting a new radius variable', async () => {
      const codeWithTags = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        codeWithTags,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const segment = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'segment'
      )
      expect(segment).toBeDefined()
      if (!segment || segment.type !== 'segment') return
      const commonFaces = getCommonFacesForEdge(segment, artifactGraph)
      if (err(commonFaces)) throw commonFaces
      const codeRefs = getCodeRefsByArtifactId(segment.id, artifactGraph)
      expect(codeRefs?.length).toBeGreaterThan(0)

      const value = (await stringToKclExpression(
        '2',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection: {
          graphSelections: [
            {
              entityRef: {
                type: 'edge',
                side_faces: commonFaces.slice(0, 2).map((face) => face.id),
              },
              codeRef: codeRefs![0],
            },
          ],
          otherSelections: [],
        },
        radius: {
          ...value,
          variableName: 'radius001',
          variableDeclarationAst: createVariableDeclaration(
            'radius001',
            value.valueAst
          ),
          variableIdentifierAst: createLocalName('radius001'),
          insertIndex: 0,
        },
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain('radius001 = 2')
      expect(newCode).toMatch(/fillet001 = fillet\(\s*extrude001/)
      expect(newCode).toMatch(/edges = \[\s*{/)
      expect(newCode).toContain('radius = radius001')
      expect(newCode).not.toContain('getCommonEdge')
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should split mixed primitive and face-reference edges without dropping either selection', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweep = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweep'
      )
      const segment = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'segment'
      )
      expect(sweep).toBeDefined()
      expect(segment).toBeDefined()
      if (!sweep || !segment || segment.type !== 'segment') return

      const commonFaces = getCommonFacesForEdge(segment, artifactGraph)
      if (err(commonFaces)) throw commonFaces
      const codeRefs = getCodeRefsByArtifactId(segment.id, artifactGraph)
      expect(codeRefs?.length).toBeGreaterThan(0)

      const selection: Selections = {
        graphSelections: [
          {
            entityRef: {
              type: 'edge',
              side_faces: commonFaces.slice(0, 2).map((face) => face.id),
            },
            codeRef: codeRefs![0],
          },
        ],
        otherSelections: [
          {
            entityId: 'primitive-edge-id',
            parentEntityId: sweep.id,
            primitiveIndex: 2,
            primitiveType: 'edge',
            type: 'enginePrimitive',
          },
        ],
      }
      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode
      expect(newCode).toContain('edge001 = edgeId(extrude001, index = 2)')
      expect(newCode).toContain(
        'fillet001 = fillet(extrude001, tags = edge001, radius = 1)'
      )
      expect(newCode).toMatch(/fillet002 = fillet\(\s*extrude001/)
      expect(newCode).toMatch(/edges = \[\s*{/)
      expect(newCode.indexOf('fillet001')).toBeLessThan(
        newCode.indexOf('fillet002')
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should preserve a shell-style graph edge through its primitive topology fallback', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweep = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweep'
      )
      const segment = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'segment'
      )
      expect(sweep).toBeDefined()
      expect(segment).toBeDefined()
      if (!sweep || !segment || segment.type !== 'segment') return

      const commonFaces = getCommonFacesForEdge(segment, artifactGraph)
      if (err(commonFaces)) throw commonFaces
      const codeRefs = getCodeRefsByArtifactId(segment.id, artifactGraph)
      expect(codeRefs?.length).toBeGreaterThan(0)

      const selection: Selections = {
        graphSelections: [
          {
            entityRef: {
              type: 'edge',
              side_faces: commonFaces.slice(0, 2).map((face) => face.id),
            },
            codeRef: codeRefs![0],
          },
          {
            entityRef: {
              type: 'edge',
              side_faces: [
                '00000000-0000-0000-0000-000000000001',
                '00000000-0000-0000-0000-000000000002',
              ],
            },
            engineTopologyFallback: {
              parentId: sweep.id,
              primitiveIndex: 2,
            },
          },
        ],
        otherSelections: [],
      }
      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode
      expect(newCode).toContain('edge001 = edgeId(extrude001, index = 2)')
      expect(newCode).toContain(
        'fillet001 = fillet(extrude001, tags = edge001, radius = 1)'
      )
      expect(newCode).toMatch(/fillet002 = fillet\(\s*extrude001/)
      expect(newCode).toMatch(/edges = \[\s*{/)
      expect(newCode.indexOf('fillet001')).toBeLessThan(
        newCode.indexOf('fillet002')
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a fillet call with edge selection on end cap (selectionV2)', async () => {
      const codeWithoutTagEnd = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        codeWithoutTagEnd,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const segment = [...artifactGraph.values()].find(
        (a): a is Extract<typeof a, { type: 'segment' }> => a.type === 'segment'
      )
      expect(segment).toBeDefined()
      if (!segment) return
      const commonFaces = getCommonFacesForEdge(segment, artifactGraph)
      if (err(commonFaces)) throw commonFaces
      expect(commonFaces.length).toBeGreaterThanOrEqual(2)
      const codeRefs = getCodeRefsByArtifactId(segment.id, artifactGraph)
      expect(codeRefs?.length).toBeGreaterThan(0)
      const selection: Selections = {
        graphSelections: [
          {
            entityRef: {
              type: 'edge',
              side_faces: commonFaces.slice(0, 2).map((f) => f.id),
            },
            codeRef: codeRefs![0],
          },
        ],
        otherSelections: [],
      }
      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode
      expect(newCode).toContain('fillet(')
      expect(newCode).toMatch(/edges = \[\s*{/)
      expect(newCode.includes('tagEnd') || newCode.includes('tagStart')).toBe(
        true
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add fillet calls on two bodies with one edge selected on each (selectionV2)', async () => {
      const twoBodiesWithTags = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> yLine(length = 5)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile002 = startProfile(sketch001, at = [6, 0])
  |> xLine(length = 5, tag = $seg02)
  |> yLine(length = 5)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
extrude002 = extrude(profile002, length = 5, tagEnd = $capEnd002)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        twoBodiesWithTags,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweeps = [...artifactGraph.values()].filter(
        (a): a is Extract<typeof a, { type: 'sweep' }> => a.type === 'sweep'
      )
      expect(sweeps.length).toBe(2)
      const segments = [...artifactGraph.values()].filter(
        (a): a is Extract<typeof a, { type: 'segment' }> => a.type === 'segment'
      )
      expect(segments.length).toBeGreaterThanOrEqual(2)
      const seg1 =
        segments.find((s) => s.pathId === sweeps[0].pathId) ?? segments[0]
      const seg2 =
        segments.find((s) => s.pathId === sweeps[1].pathId) ?? segments[1]
      const common1 = getCommonFacesForEdge(seg1, artifactGraph)
      const common2 = getCommonFacesForEdge(seg2, artifactGraph)
      if (err(common1)) throw common1
      if (err(common2)) throw common2
      expect(common1.length).toBeGreaterThanOrEqual(2)
      expect(common2.length).toBeGreaterThanOrEqual(2)
      const codeRefs1 = getCodeRefsByArtifactId(seg1.id, artifactGraph)
      const codeRefs2 = getCodeRefsByArtifactId(seg2.id, artifactGraph)
      expect(codeRefs1?.length).toBeGreaterThan(0)
      expect(codeRefs2?.length).toBeGreaterThan(0)
      const selection: Selections = {
        graphSelections: [
          {
            entityRef: {
              type: 'edge',
              side_faces: common1.slice(0, 2).map((f) => f.id),
            },
            codeRef: codeRefs1![0],
          },
          {
            entityRef: {
              type: 'edge',
              side_faces: common2.slice(0, 2).map((f) => f.id),
            },
            codeRef: codeRefs2![0],
          },
        ],
        otherSelections: [],
      }
      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toMatch(/fillet001 = fillet\(\s*extrude001/)
      expect(newCode).toMatch(/fillet002 = fillet\(\s*extrude002/)
      expect(newCode).toMatch(/edges = \[\s*{/)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addChamfer', () => {
    it('should insert a new length variable and add version when editing a chamfer', async () => {
      const call =
        'chamfer(solid001, edges = [{ sideFaces = [face001, face002] }], length = 1)'
      const code = `solid001 = cube(size = 10)
chamfer001 = ${call}`
      const ast = assertParse(code, instanceInThisFile)
      const callStart = code.indexOf(call)
      const nodeToEdit = getNodePathFromSourceRange(
        ast,
        topLevelRange(callStart, callStart + call.length)
      )
      const lengthValue = (await stringToKclExpression(
        '3',
        rustContextInThisFile
      )) as KclCommandValue
      const version = (await stringToKclExpression(
        '2',
        rustContextInThisFile
      )) as KclCommandValue

      const result = addChamfer({
        ast,
        artifactGraph: new Map(),
        selection: { graphSelections: [], otherSelections: [] },
        length: {
          ...lengthValue,
          variableName: 'length001',
          variableDeclarationAst: createVariableDeclaration(
            'length001',
            lengthValue.valueAst
          ),
          variableIdentifierAst: createLocalName('length001'),
          insertIndex: 0,
        },
        version,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain('length001 = 3')
      expect(newCode).toContain('length = length001')
      expect(newCode).toContain('version = 2')
    })

    it('should add a chamfer call using engine primitive edge indices', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweep = [...artifactGraph.values()].find((a) => a.type === 'sweep')
      expect(sweep).toBeDefined()

      const primitiveEdge: NonCodeSelection = {
        entityId: 'irrelevant-for-this-test',
        parentEntityId: sweep?.id,
        primitiveIndex: 2,
        primitiveType: 'edge',
        type: 'enginePrimitive',
      }
      const selection: Selections = {
        graphSelections: [],
        otherSelections: [primitiveEdge],
      }

      const length = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `${extrudedTriangle}
edge001 = edgeId(extrude001, index = 2)
chamfer001 = chamfer(extrude001, tags = edge001, length = 1)`
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a basic chamfer call with edge selection (selectionV2)', async () => {
      const codeWithTags = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        codeWithTags,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const segment = [...artifactGraph.values()].find(
        (a): a is Extract<typeof a, { type: 'segment' }> => a.type === 'segment'
      )
      expect(segment).toBeDefined()
      if (!segment) return
      const commonFaces = getCommonFacesForEdge(segment, artifactGraph)
      if (err(commonFaces)) throw commonFaces
      expect(commonFaces.length).toBeGreaterThanOrEqual(2)
      const codeRefs = getCodeRefsByArtifactId(segment.id, artifactGraph)
      expect(codeRefs?.length).toBeGreaterThan(0)
      const selection: Selections = {
        graphSelections: [
          {
            entityRef: {
              type: 'edge',
              side_faces: commonFaces.slice(0, 2).map((f) => f.id),
            },
            codeRef: codeRefs![0],
          },
        ],
        otherSelections: [],
      }
      const length = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain('chamfer(')
      expect(newCode).toContain('length = 1')
      expect(newCode).toMatch(/edges = \[\s*{/)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should split mixed primitive and face-reference edges without dropping either selection', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweep = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweep'
      )
      const segment = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'segment'
      )
      expect(sweep).toBeDefined()
      expect(segment).toBeDefined()
      if (!sweep || !segment || segment.type !== 'segment') return

      const commonFaces = getCommonFacesForEdge(segment, artifactGraph)
      if (err(commonFaces)) throw commonFaces
      const codeRefs = getCodeRefsByArtifactId(segment.id, artifactGraph)
      expect(codeRefs?.length).toBeGreaterThan(0)

      const selection: Selections = {
        graphSelections: [
          {
            entityRef: {
              type: 'edge',
              side_faces: commonFaces.slice(0, 2).map((face) => face.id),
            },
            codeRef: codeRefs![0],
          },
        ],
        otherSelections: [
          {
            entityId: 'primitive-edge-id',
            parentEntityId: sweep.id,
            primitiveIndex: 2,
            primitiveType: 'edge',
            type: 'enginePrimitive',
          },
        ],
      }
      const length = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode
      expect(newCode).toContain('edge001 = edgeId(extrude001, index = 2)')
      expect(newCode).toContain(
        'chamfer001 = chamfer(extrude001, tags = edge001, length = 1)'
      )
      expect(newCode).toMatch(/chamfer002 = chamfer\(\s*extrude001/)
      expect(newCode).toMatch(/edges = \[\s*{/)
      expect(newCode.indexOf('chamfer001')).toBeLessThan(
        newCode.indexOf('chamfer002')
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a chamfer call with edge selection on end cap (selectionV2)', async () => {
      const codeWithoutTagEnd = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        codeWithoutTagEnd,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const segment = [...artifactGraph.values()].find(
        (a): a is Extract<typeof a, { type: 'segment' }> => a.type === 'segment'
      )
      expect(segment).toBeDefined()
      if (!segment) return
      const commonFaces = getCommonFacesForEdge(segment, artifactGraph)
      if (err(commonFaces)) throw commonFaces
      expect(commonFaces.length).toBeGreaterThanOrEqual(2)
      const codeRefs = getCodeRefsByArtifactId(segment.id, artifactGraph)
      expect(codeRefs?.length).toBeGreaterThan(0)
      const selection: Selections = {
        graphSelections: [
          {
            entityRef: {
              type: 'edge',
              side_faces: commonFaces.slice(0, 2).map((f) => f.id),
            },
            codeRef: codeRefs![0],
          },
        ],
        otherSelections: [],
      }
      const length = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode
      expect(newCode).toContain('chamfer(')
      expect(newCode).toMatch(/edges = \[\s*{/)
      expect(newCode.includes('tagEnd') || newCode.includes('tagStart')).toBe(
        true
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add chamfer calls on two bodies with one edge selected on each (selectionV2)', async () => {
      const twoBodiesWithTags = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> yLine(length = 5)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile002 = startProfile(sketch001, at = [6, 0])
  |> xLine(length = 5, tag = $seg02)
  |> yLine(length = 5)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
extrude002 = extrude(profile002, length = 5, tagEnd = $capEnd002)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        twoBodiesWithTags,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweeps = [...artifactGraph.values()].filter(
        (a): a is Extract<typeof a, { type: 'sweep' }> => a.type === 'sweep'
      )
      expect(sweeps.length).toBe(2)
      const segments = [...artifactGraph.values()].filter(
        (a): a is Extract<typeof a, { type: 'segment' }> => a.type === 'segment'
      )
      expect(segments.length).toBeGreaterThanOrEqual(2)
      const seg1 =
        segments.find((s) => s.pathId === sweeps[0].pathId) ?? segments[0]
      const seg2 =
        segments.find((s) => s.pathId === sweeps[1].pathId) ?? segments[1]
      const common1 = getCommonFacesForEdge(seg1, artifactGraph)
      const common2 = getCommonFacesForEdge(seg2, artifactGraph)
      if (err(common1)) throw common1
      if (err(common2)) throw common2
      expect(common1.length).toBeGreaterThanOrEqual(2)
      expect(common2.length).toBeGreaterThanOrEqual(2)
      const codeRefs1 = getCodeRefsByArtifactId(seg1.id, artifactGraph)
      const codeRefs2 = getCodeRefsByArtifactId(seg2.id, artifactGraph)
      expect(codeRefs1?.length).toBeGreaterThan(0)
      expect(codeRefs2?.length).toBeGreaterThan(0)
      const selection: Selections = {
        graphSelections: [
          {
            entityRef: {
              type: 'edge',
              side_faces: common1.slice(0, 2).map((f) => f.id),
            },
            codeRef: codeRefs1![0],
          },
          {
            entityRef: {
              type: 'edge',
              side_faces: common2.slice(0, 2).map((f) => f.id),
            },
            codeRef: codeRefs2![0],
          },
        ],
        otherSelections: [],
      }
      const length = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toMatch(/chamfer001 = chamfer\(\s*extrude001/)
      expect(newCode).toMatch(/chamfer002 = chamfer\(\s*extrude002/)
      expect(newCode).toMatch(/edges = \[\s*{/)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addBlend', () => {
    it('should add a blend call from exactly two segments', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        twoSurfacesForBlend,
        instanceInThisFile,
        kclManagerInThisFile
      )

      const segments = [...artifactGraph.values()].filter(
        (a) => a.type === 'segment'
      )
      expect(segments.length).toBe(2)
      const edges = createSelectionFromArtifacts(segments, artifactGraph)

      const result = addBlend({
        ast,
        artifactGraph,
        edges,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }
      expect(newCode).toContain('blend001 = blend([')
      expect(newCode.match(/getBoundedEdge\(/g)?.length).toBe(2)

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a blend call from exactly two primitive edges', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        twoSurfacesForBlend,
        instanceInThisFile,
        kclManagerInThisFile
      )

      const sweeps = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweep'
      )
      expect(sweeps.length).toBeGreaterThanOrEqual(2)

      const primitiveEdgeSelections: NonCodeSelection[] = [
        {
          entityId: 'blend-primitive-edge-1',
          parentEntityId: sweeps[0].id,
          primitiveIndex: 0,
          primitiveType: 'edge',
          type: 'enginePrimitive',
        },
        {
          entityId: 'blend-primitive-edge-2',
          parentEntityId: sweeps[1].id,
          primitiveIndex: 0,
          primitiveType: 'edge',
          type: 'enginePrimitive',
        },
      ]

      const edges: Selections = {
        graphSelections: [],
        otherSelections: primitiveEdgeSelections,
      }

      const result = addBlend({
        ast,
        artifactGraph,
        edges,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }
      expect(newCode).toContain('blend001 = blend([')
      expect(newCode.match(/getBoundedEdge\(/g)?.length).toBe(2)
      expect(newCode.match(/edgeId\(/g)?.length).toBe(2)

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a blend call between surfaces from sketch solve segments', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        sketchSolveSurfacesForBlend,
        instanceInThisFile,
        kclManagerInThisFile
      )

      const sweeps = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweep'
      )
      expect(sweeps.length).toBe(2)

      const segmentBody1 = [...artifactGraph.values()].find(
        (a) => a.type === 'segment' && a.pathId === sweeps[0].pathId
      )
      const segmentBody2 = [...artifactGraph.values()].find(
        (a) => a.type === 'segment' && a.pathId === sweeps[1].pathId
      )
      if (
        !segmentBody1 ||
        segmentBody1.type !== 'segment' ||
        !segmentBody2 ||
        segmentBody2.type !== 'segment'
      ) {
        throw new Error(
          'Could not resolve sketch segments for direct blend refs'
        )
      }

      const edges = createSelectionFromArtifacts(
        [segmentBody1, segmentBody2],
        artifactGraph
      )

      const result = addBlend({
        ast,
        artifactGraph,
        edges,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }
      expect(newCode).toContain(
        `blend001 = blend([
  getBoundedEdge(extrude001, edge = extrude001.sketch.tags.line1),
  getBoundedEdge(extrude002, edge = extrude002.sketch.tags.line1)
])`
      )

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should fail when fewer than two edges are selected', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        twoSurfacesForBlend,
        instanceInThisFile,
        kclManagerInThisFile
      )

      const singleSegment = [...artifactGraph.values()].find(
        (a): a is Extract<typeof a, { type: 'segment' }> => a.type === 'segment'
      )
      expect(singleSegment).toBeDefined()
      const edges = createSelectionFromArtifacts(
        singleSegment ? [singleSegment] : [],
        artifactGraph
      )

      const result = addBlend({
        ast,
        artifactGraph,
        edges,
        wasmInstance: instanceInThisFile,
      })
      if (!err(result)) {
        throw new Error('Expected addBlend to fail for a single selected edge')
      }

      expect(result.message).toBe('Blend requires exactly two selected edges.')
    })
  })

  describe('Testing retrieveEdgeSelectionsFromOpArgs', () => {
    it('preserves edge disambiguators when recovering a single edge reference', async () => {
      const { artifactGraph } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const segment = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'segment'
      )
      expect(segment).toBeDefined()
      if (!segment || segment.type !== 'segment') return
      const commonFaces = getCommonFacesForEdge(segment, artifactGraph)
      if (err(commonFaces)) throw commonFaces
      expect(commonFaces).toHaveLength(2)
      const endFaceIds = [crypto.randomUUID(), crypto.randomUUID()]

      const selections = retrieveEdgeSelectionsFromSingleEdgeRef(
        {
          value: {
            type: 'Object',
            value: {
              sideFaces: {
                type: 'Array',
                value: commonFaces.map((face) => ({
                  type: 'Uuid' as const,
                  value: face.id,
                })),
              },
              endFaces: {
                type: 'Array',
                value: endFaceIds.map((value) => ({
                  type: 'Uuid' as const,
                  value,
                })),
              },
              index: {
                type: 'Number',
                value: 3,
                ty: { type: 'Unknown' },
              },
            },
          },
          sourceRange: topLevelRange(0, 0),
        },
        artifactGraph
      )
      if (err(selections)) throw selections

      expect(selections.graphSelections).toHaveLength(1)
      expect(selections.graphSelections[0].entityRef).toEqual({
        type: 'edge',
        side_faces: commonFaces.map((face) => face.id),
        end_faces: endFaceIds,
        index: 3,
      })
    })

    it('should retrieve graph and primitive edge selections from mixed tags', async () => {
      const code = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 0deg, length = 30, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90deg, length = 30, tag = $seg02)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(
  sketch001,
  length = 30,
  tagEnd = $capEnd001,
  tagStart = $capStart001,
)
shell001 = shell(extrude001, faces = capEnd001, thickness = 1)
chamfer001 = chamfer(
  extrude001,
  tags = [
    getCommonEdge(faces = [rectangleSegmentA001, capStart001]),
    getCommonEdge(faces = [seg02, capStart001]),
    edgeId(extrude001, index = 20),
    edgeId(extrude001, index = 12)
  ],
  length = 1,
)`
      const { artifactGraph, operations } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const op = getAllOperations(operations).find(
        (o) => o.type === 'StdLibCall' && o.name === 'chamfer'
      )
      if (
        !op ||
        op.type !== 'StdLibCall' ||
        !op.unlabeledArg ||
        !op.labeledArgs?.tags
      ) {
        throw new Error('Chamfer operation not found')
      }

      const selections = retrieveEdgeSelectionsFromOpArgs(
        op.unlabeledArg,
        op.labeledArgs.tags,
        artifactGraph,
        code
      )

      expect(selections.graphSelections).toHaveLength(2)
      for (const v2 of selections.graphSelections) {
        expect(v2.entityRef).toBeDefined()
        expect(['segment', 'edge']).toContain(v2.entityRef?.type)
        expect(v2.codeRef).toBeDefined()
      }

      expect(selections.otherSelections).toHaveLength(0)
    })
  })

  const runDeleteEdgeTreatmentTest = async (
    code: string,
    edgeTreatmentSnippet: string,
    expectedCode: string,
    instance: ModuleType,
    kclManager: KclManager
  ) => {
    // parse ast
    const ast = assertParse(code, instance)

    // update artifact graph
    await kclManager.executeAst({ ast })
    const artifactGraph = kclManager.artifactGraph

    expect(kclManager.errors).toEqual([])

    // define snippet range
    const edgeTreatmentRange = topLevelRange(
      code.indexOf(edgeTreatmentSnippet),
      code.indexOf(edgeTreatmentSnippet) + edgeTreatmentSnippet.length
    )

    // find artifact
    const maybeArtifact = [...artifactGraph].find(([, artifact]) => {
      if (!('codeRef' in artifact) || !artifact.codeRef) return false
      return isOverlap(artifact.codeRef.range, edgeTreatmentRange)
    })

    // build selection
    const selection: ResolvedGraphSelection = {
      codeRef: codeRefFromRange(edgeTreatmentRange, ast),
      artifact: maybeArtifact ? maybeArtifact[1] : undefined,
    }

    // delete edge treatment
    const result = await deleteEdgeTreatment(ast, selection, instanceInThisFile)
    if (err(result)) {
      expect(result).toContain(expectedCode)
      return result
    }

    // recast and check
    const newCode = recast(result, instance)
    expect(newCode).toContain(expectedCode)
  }
  // Iterate tests over all edge treatment types
  Object.values(EdgeTreatmentType).forEach(
    (edgeTreatmentType: EdgeTreatmentType) => {
      // create parameters based on the edge treatment type
      let parameterName: string
      if (edgeTreatmentType === EdgeTreatmentType.Fillet) {
        parameterName = 'radius'
      } else if (edgeTreatmentType === EdgeTreatmentType.Chamfer) {
        parameterName = 'length'
      } else {
        // Handle future edge treatments
        return new Error(
          `Unsupported edge treatment type: ${edgeTreatmentType}`
        )
      }

      describe(`Testing deleteEdgeTreatment with ${edgeTreatmentType}s`, () => {
        // simple cases
        it(`should delete a piped ${edgeTreatmentType} from a single segment`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])`
          const edgeTreatmentSnippet = `${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        it(`should delete a standalone assigned ${edgeTreatmentType} from a single segment`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
${edgeTreatmentType}001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [seg01])`
          const edgeTreatmentSnippet = `${edgeTreatmentType}001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [seg01])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        it(`should delete a standalone ${edgeTreatmentType} without assignment from a single segment`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
${edgeTreatmentType}(extrude001, ${parameterName} = 5, tags = [seg01])`
          const edgeTreatmentSnippet = `${edgeTreatmentType}(extrude001, ${parameterName} = 5, tags = [seg01])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        // getOppositeEdge and getNextAdjacentEdge cases
        it(`should delete a piped ${edgeTreatmentType} tagged with getOppositeEdge`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [getOppositeEdge(seg01)])`
          const edgeTreatmentSnippet = `fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [getOppositeEdge(seg01)])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        it(`should delete a non-piped ${edgeTreatmentType} tagged with getNextAdjacentEdge`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [getNextAdjacentEdge(seg01)])`
          const edgeTreatmentSnippet = `fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [getNextAdjacentEdge(seg01)])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        // cases with several edge treatments
        it(`should delete a piped ${edgeTreatmentType} from a body with multiple treatments`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])
  |> fillet(radius = 5, tags = [getOppositeEdge(seg02)])
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])
chamfer001 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])`
          const edgeTreatmentSnippet = `${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])
chamfer001 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        it(`should delete a non-piped ${edgeTreatmentType} from a body with multiple treatments`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])
  |> fillet( radius = 5, tags = [getOppositeEdge(seg02)] )
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])
chamfer001 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])`
          const edgeTreatmentSnippet = `fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])
  |> fillet(radius = 5, tags = [getOppositeEdge(seg02)])
chamfer001 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        // Revolve-specific test
        it(`should delete a ${edgeTreatmentType} from a revolved C-shape with rectangular profile`, async () => {
          const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 1])
  |> yLine(length = 3)
  |> xLine(length = 4, tag = $seg01)
  |> yLine(length = -3)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(
  profile001,
  angle = 270deg,
  axis = X,
  tagStart = $capStart001,
)
${edgeTreatmentType}001 = ${edgeTreatmentType}(revolve001, tags = getCommonEdge(faces = [seg01, capStart001]), ${parameterName} = 1)`
          const edgeTreatmentSnippet = `${edgeTreatmentType}001 = ${edgeTreatmentType}(revolve001, tags = getCommonEdge(faces = [seg01, capStart001]), ${parameterName} = 1)`
          const expectedCode = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 1])
  |> yLine(length = 3)
  |> xLine(length = 4, tag = $seg01)
  |> yLine(length = -3)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(
  profile001,
  angle = 270deg,
  axis = X,
  tagStart = $capStart001,
)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        // Test deletion of geometrically impossible edge treatment
        it(`should delete a ${edgeTreatmentType} with geometrically impossible value from a revolved shape`, async () => {
          const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 1])
  |> yLine(length = 3)
  |> xLine(length = 4)
  |> yLine(length = -3, tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(
  profile001,
  angle = 270deg,
  axis = X,
  tagStart = $capStart001,
)
${edgeTreatmentType}001 = ${edgeTreatmentType}(revolve001, tags = getCommonEdge(faces = [seg01, capStart001]), ${parameterName} = 5)`
          const edgeTreatmentSnippet = `${edgeTreatmentType}001 = ${edgeTreatmentType}(revolve001, tags = getCommonEdge(faces = [seg01, capStart001]), ${parameterName} = 5)`
          const expectedCode = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 1])
  |> yLine(length = 3)
  |> xLine(length = 4)
  |> yLine(length = -3, tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(
  profile001,
  angle = 270deg,
  axis = X,
  tagStart = $capStart001,
)`

          // This test case is special because the fillet/chamfer is geometrically impossible
          // (value too large), so we can't execute the AST. Instead, we test that the deletion
          // works purely on the AST level without needing execution artifacts.
          const ast = assertParse(code, instanceInThisFile)

          // define snippet range
          const edgeTreatmentRange = topLevelRange(
            code.indexOf(edgeTreatmentSnippet),
            code.indexOf(edgeTreatmentSnippet) + edgeTreatmentSnippet.length
          )

          const edgeTreatmentCodeRef = codeRefFromRange(edgeTreatmentRange, ast)

          // build selection with a mock edgeCut artifact
          const selection: ResolvedGraphSelection = {
            codeRef: edgeTreatmentCodeRef,
            artifact: {
              type: 'edgeCut',
              consumedEdgeId: '',
              edgeIds: [],
              id: 'mock-edge-cut-id',
              subType: edgeTreatmentType,
              codeRef: {
                range: edgeTreatmentCodeRef.range,
                pathToNode: edgeTreatmentCodeRef.pathToNode,
                nodePath: { steps: [] },
              },
            },
          }

          // delete edge treatment
          const result = await deleteEdgeTreatment(
            ast,
            selection,
            instanceInThisFile
          )
          if (err(result)) {
            throw result
          }

          // recast and check
          const newCode = recast(result, instanceInThisFile)
          expect(newCode).toContain(expectedCode)
        }, 10_000)
        // Test deletion of geometrically impossible edge treatment (piped case)
        it(`should delete a piped ${edgeTreatmentType} with geometrically impossible value from a revolved shape`, async () => {
          const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 1])
  |> yLine(length = 3)
  |> xLine(length = 4)
  |> yLine(length = -3, tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(
  profile001,
  angle = 270deg,
  axis = X,
  tagStart = $capStart001,
)
  |> ${edgeTreatmentType}(tags = getCommonEdge(faces = [seg01, capStart001]), ${parameterName} = 5)`
          const edgeTreatmentSnippet = `${edgeTreatmentType}(tags = getCommonEdge(faces = [seg01, capStart001]), ${parameterName} = 5)`
          const expectedCode = `yLine(length = -3, tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(`

          // This test case is special because the fillet/chamfer is geometrically impossible
          // (value too large), so we can't execute the AST. Instead, we test that the deletion
          // works purely on the AST level without needing execution artifacts.
          const ast = assertParse(code, instanceInThisFile)

          // define snippet range
          const edgeTreatmentRange = topLevelRange(
            code.indexOf(edgeTreatmentSnippet),
            code.indexOf(edgeTreatmentSnippet) + edgeTreatmentSnippet.length
          )

          const edgeTreatmentCodeRef = codeRefFromRange(edgeTreatmentRange, ast)

          // build selection with a mock edgeCut artifact
          const selection: ResolvedGraphSelection = {
            codeRef: edgeTreatmentCodeRef,
            artifact: {
              type: 'edgeCut',
              consumedEdgeId: '',
              edgeIds: [],
              id: 'mock-edge-cut-id',
              subType: edgeTreatmentType,
              codeRef: {
                range: edgeTreatmentCodeRef.range,
                pathToNode: edgeTreatmentCodeRef.pathToNode,
                nodePath: { steps: [] },
              },
            },
          }

          // delete edge treatment
          const result = await deleteEdgeTreatment(
            ast,
            selection,
            instanceInThisFile
          )
          if (err(result)) {
            throw result
          }

          // recast and check
          const newCode = recast(result, instanceInThisFile)
          expect(newCode).toContain(expectedCode)
        }, 10_000)
      })
    }
  )
})
