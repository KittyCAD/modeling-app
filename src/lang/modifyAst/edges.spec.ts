import type { KclManager } from '@src/lang/KclManager'
import { createLocalName, createVariableDeclaration } from '@src/lang/create'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import {
  EdgeTreatmentType,
  addBlend,
  addChamfer,
  addFillet,
  deleteEdgeTreatment,
  retrieveEdgeSelectionsFromOpArgs,
  retrieveEdgeSelectionsFromSingleEdgeRef,
} from '@src/lang/modifyAst/edges'
import { getNodeFromPath } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { ResolvedGraphSelection } from '@src/lang/std/artifactGraph'
import {
  codeRefFromRange,
  getCodeRefsByArtifactId,
  getCommonFacesForEdge,
  getOriginalSegmentArtifact,
} from '@src/lang/std/artifactGraph'
import { findKwArg, topLevelRange } from '@src/lang/util'
import {
  type ArtifactGraph,
  type CallExpressionKw,
  type PathToNode,
  type SweepEdgeArtifact,
  assertParse,
  getAllOperations,
  recast,
} from '@src/lang/wasm'
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
    await buildTheWorldAndConnectToEngine({ webrtc: false })
  instanceInThisFile = instance
  kclManagerInThisFile = kclManager
  rustContextInThisFile = rustContext
  engineCommandManagerInThisFile = engineCommandManager
})
afterAll(() => {
  engineCommandManagerInThisFile.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

describe('edges.spec.ts', () => {
  const extrudedTriangle = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5)`
  const extrudedTriangleWithFillet = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
fillet001 = fillet(extrude001, tags = getCommonEdge(faces = [seg01, extrude001.faces.capEnd001]), radius = 1)`
  const _extrudedTriangleWithChamfer = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
chamfer001 = chamfer(extrude001, tags = getCommonEdge(faces = [seg01, capEnd001]), length = 1)`
  const twoExtrudedTriangles = `sketch001 = startSketchOn(XY)
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
  const revolvedCShapeWithRectangularProfile = `sketch001 = startSketchOn(XY)
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
  // Face API creation tests use edge references with adjacent face IDs.
  // Legacy tags edit tests also cover UUIDs identifying sweepEdge artifacts.

  function selectionFromSweepEdge(
    edge: SweepEdgeArtifact,
    artifactGraph: ArtifactGraph
  ): Selection {
    const sideFaces = edge.commonSurfaceIds
    if (!sideFaces || sideFaces.length < 2) {
      throw new Error('Sweep edge adjacent faces not found')
    }
    const codeRef = getCodeRefsByArtifactId(edge.id, artifactGraph)?.[0]
    if (!codeRef) throw new Error('Sweep edge code reference not found')
    return { entityRef: { type: 'edge', side_faces: sideFaces }, codeRef }
  }

  describe('Testing addFillet', () => {
    it.each([
      'tags = [edgeTag]',
      'edges = [{ sideFaces = [sideTag, capTag] }]',
      'edgeRefs = [edgeRef]',
    ])(
      'edits scalar arguments with an unavailable %s selection',
      async (selectionArgument) => {
        const code = `fillet001 = fillet(body, ${selectionArgument}, radius = 1)`
        const ast = assertParse(code, instanceInThisFile)
        const radius = (await stringToKclExpression(
          '2',
          rustContextInThisFile
        )) as KclCommandValue

        const result = addFillet({
          ast,
          artifactGraph: new Map() as ArtifactGraph,
          selection: { graphSelections: [], otherSelections: [] },
          radius,
          nodeToEdit: createPathToNodeForLastVariable(ast, false),
          wasmInstance: instanceInThisFile,
        })
        if (err(result)) throw result

        const newCode = recast(result.modifiedAst, instanceInThisFile)
        if (err(newCode)) throw newCode
        expect(newCode.trim()).toBe(code.replace('radius = 1', 'radius = 2'))
      }
    )

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

    it('should add a fillet to the post-subtract body when selecting the original box edge', async () => {
      const code = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

boxLength = 100
boxWidth = 100
boxHeight = 50
cutoutRadius = 30
cutoutDepth = 10
chamferSize = 2

cutoutStartZ = boxHeight - cutoutDepth
cutoutLowerWallZ = cutoutStartZ + chamferSize
cutoutUpperWallZ = boxHeight - chamferSize
cutoutLowerChamferRadius = cutoutRadius - chamferSize
cutoutWallRadius = cutoutRadius
cutoutUpperChamferRadius = cutoutRadius + chamferSize

boxProfile = sketch(on = XY) {
  bottomEdge = line(start = [var 0mm, var 0mm], end = [var 100mm, var 0mm])
  rightEdge = line(start = [var 100mm, var 0mm], end = [var 100mm, var 100mm])
  topEdge = line(start = [var 100mm, var 100mm], end = [var 0mm, var 100mm])
  leftEdge = line(start = [var 0mm, var 100mm], end = [var 0mm, var 0mm])

  coincident([bottomEdge.end, rightEdge.start])
  coincident([rightEdge.end, topEdge.start])
  coincident([topEdge.end, leftEdge.start])
  coincident([leftEdge.end, bottomEdge.start])

  horizontal(bottomEdge)
  vertical(rightEdge)
  horizontal(topEdge)
  vertical(leftEdge)

  horizontalDistance([ORIGIN, bottomEdge.start]) == 0mm
  verticalDistance([ORIGIN, bottomEdge.start]) == 0mm
  horizontalDistance([bottomEdge.start, bottomEdge.end]) == boxLength
  verticalDistance([bottomEdge.start, leftEdge.start]) == boxWidth
}

boxRegion = region(point = [boxLength / 2, boxWidth / 2], sketch = boxProfile)
boxSolid = extrude(boxRegion, length = boxHeight)

bottomPlane = offsetPlane(XY, offset = cutoutStartZ)
lowerWallPlane = offsetPlane(XY, offset = cutoutLowerWallZ)
upperWallPlane = offsetPlane(XY, offset = cutoutUpperWallZ)
topPlane = offsetPlane(XY, offset = boxHeight)

bottomProfile = sketch(on = bottomPlane) {
  bottomCircle = circle(start = [var 28mm, var 0mm], center = [var 0mm, var 0mm])

  horizontalDistance([ORIGIN, bottomCircle.center]) == 0mm
  verticalDistance([ORIGIN, bottomCircle.center]) == 0mm
  horizontalDistance([bottomCircle.center, bottomCircle.start]) == cutoutLowerChamferRadius
  verticalDistance([bottomCircle.center, bottomCircle.start]) == 0mm
}

lowerWallProfile = sketch(on = lowerWallPlane) {
  lowerWallCircle = circle(start = [var 30mm, var 0mm], center = [var 0mm, var 0mm])

  horizontalDistance([ORIGIN, lowerWallCircle.center]) == 0mm
  verticalDistance([ORIGIN, lowerWallCircle.center]) == 0mm
  horizontalDistance([lowerWallCircle.center, lowerWallCircle.start]) == cutoutWallRadius
  verticalDistance([lowerWallCircle.center, lowerWallCircle.start]) == 0mm
}

upperWallProfile = sketch(on = upperWallPlane) {
  upperWallCircle = circle(start = [var 30mm, var 0mm], center = [var 0mm, var 0mm])

  horizontalDistance([ORIGIN, upperWallCircle.center]) == 0mm
  verticalDistance([ORIGIN, upperWallCircle.center]) == 0mm
  horizontalDistance([upperWallCircle.center, upperWallCircle.start]) == cutoutWallRadius
  verticalDistance([upperWallCircle.center, upperWallCircle.start]) == 0mm
}

topProfile = sketch(on = topPlane) {
  topCircle = circle(start = [var 32mm, var 0mm], center = [var 0mm, var 0mm])

  horizontalDistance([ORIGIN, topCircle.center]) == 0mm
  verticalDistance([ORIGIN, topCircle.center]) == 0mm
  horizontalDistance([topCircle.center, topCircle.start]) == cutoutUpperChamferRadius
  verticalDistance([topCircle.center, topCircle.start]) == 0mm
}

bottomRegion = region(point = [0mm, 0mm], sketch = bottomProfile)
lowerWallRegion = region(point = [0mm, 0mm], sketch = lowerWallProfile)
upperWallRegion = region(point = [0mm, 0mm], sketch = upperWallProfile)
topRegion = region(point = [0mm, 0mm], sketch = topProfile)

cutoutCutter = loft([
  bottomRegion,
  lowerWallRegion,
  upperWallRegion,
  topRegion,
])

part = subtract(boxSolid, tools = [cutoutCutter])
  |> appearance(color = "#8f96a3", roughness = 55, metalness = 8)

hide([boxProfile, bottomProfile, lowerWallProfile, upperWallProfile, topProfile])`

      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const boxSolidStart = code.indexOf('boxSolid = extrude')
      const boxSolidEnd = code.indexOf('bottomPlane =')
      const boxSweep = [...artifactGraph.values()].find(
        (artifact) =>
          artifact.type === 'sweep' &&
          artifact.codeRef.range[0] >= boxSolidStart &&
          artifact.codeRef.range[0] < boxSolidEnd
      )
      if (!boxSweep) {
        throw new Error('boxSolid sweep artifact not found')
      }

      const topEdgeStart = code.indexOf('topEdge = line')
      const topEdgeRange = topLevelRange(
        topEdgeStart,
        code.indexOf('\n', topEdgeStart)
      )
      const topWall = [...artifactGraph.values()].find((artifact) => {
        if (artifact.type !== 'wall' || artifact.sweepId !== boxSweep.id) {
          return false
        }
        const segment = getOriginalSegmentArtifact(
          artifact.segId,
          artifactGraph
        )
        return segment && isOverlap(segment.codeRef.range, topEdgeRange)
      })
      const endCap = [...artifactGraph.values()].find(
        (artifact) =>
          artifact.type === 'cap' &&
          artifact.sweepId === boxSweep.id &&
          artifact.subType === 'end'
      )
      if (!topWall || topWall.type !== 'wall' || !endCap) {
        throw new Error('boxSolid top edge wall and end cap not found')
      }
      const codeRef = getCodeRefsByArtifactId(topWall.segId, artifactGraph)?.[0]
      if (!codeRef)
        throw new Error('boxSolid top edge code reference not found')

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
                side_faces: [topWall.id, endCap.id],
              },
              codeRef,
            },
          ],
          otherSelections: [],
        },
        radius,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode
      expect(newCode).toMatch(
        /fillet001 = fillet\(\s*part,\s*edges = \[\s*\{\s*sideFaces = \[/
      )
      expect(newCode).toContain('boxRegion.tags.topEdge')
      expect(newCode).toContain('radius = 1')
      await kclManagerInThisFile.executeAst({ ast: result.modifiedAst })
      expect(kclManagerInThisFile.errors).toEqual([])
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

    it('keeps mixed face-reference and primitive edges on the same resolved Boolean body', async () => {
      const code = `@settings(kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(point = [0mm, 0mm], sketch = sketch001)
extrude001 = extrude(region001, length = 10)

sketch002 = sketch(on = XY) {
  circle1 = circle(start = [var 4mm, var 0mm], center = [var 0mm, var 0mm])
}
region002 = region(point = [0mm, 0mm], sketch = sketch002)
extrude002 = extrude(region002, length = 10)
part = subtract(extrude001, tools = extrude002)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweeps = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweep'
      )
      expect(sweeps).toHaveLength(2)
      const sourceSweep = sweeps.find(
        (sweep) => sweep.codeRef.range[0] < code.indexOf('sketch002 =')
      )
      if (!sourceSweep) throw new Error('Original extrusion not found')
      const sweepEdge = [...artifactGraph.values()].find(
        (artifact) =>
          artifact.type === 'sweepEdge' &&
          artifact.sweepId === sourceSweep.id &&
          artifact.subType === 'opposite'
      )
      const part = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'compositeSolid'
      )
      if (!sweepEdge || sweepEdge.type !== 'sweepEdge' || !part) {
        throw new Error('Source edge or Boolean result not found')
      }
      const sideFaces = sweepEdge.commonSurfaceIds
      if (!sideFaces || sideFaces.length < 2) {
        throw new Error('Source edge adjacent faces not found')
      }
      const codeRef = getCodeRefsByArtifactId(sweepEdge.id, artifactGraph)?.[0]
      if (!codeRef) throw new Error('Source edge code reference not found')

      const selection: Selections = {
        graphSelections: [
          { entityRef: { type: 'edge', side_faces: sideFaces }, codeRef },
        ],
        otherSelections: [
          {
            entityId: 'irrelevant-for-this-test',
            parentEntityId: part.id,
            primitiveIndex: 0,
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
      expect(result.pathToNode).toHaveLength(2)
      expect(newCode).toContain('edge001 = edgeId(part, index = 0)')
      expect(newCode).toContain(
        'fillet001 = fillet(part, tags = edge001, radius = 1)'
      )
      expect(newCode).toMatch(/fillet002 = fillet\(\s*part,\s*edges = \[/)
      expect(newCode).toContain('region001.tags.circle1')
      expect(newCode).not.toContain('getCommonEdge')
      expect(newCode.indexOf('fillet001')).toBeLessThan(
        newCode.indexOf('fillet002')
      )
      await getAstAndArtifactGraph(
        newCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(kclManagerInThisFile.errors).toEqual([])
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

    it.each(['body001', 'body002'] as const)(
      'fillets an edge on %s and qualifies its cap after cloning',
      async (bodyName) => {
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
        if (!originalSweep) throw new Error('Original sweep artifact not found')
        const selectedSweep =
          bodyName === 'body001'
            ? originalSweep
            : [...artifactGraph.values()].find(
                (artifact) =>
                  artifact.type === 'sweep' &&
                  artifact.sourceSweepId === originalSweep.id
              )
        if (!selectedSweep) throw new Error('Cloned sweep artifact not found')
        const endCap = [...artifactGraph.values()].find(
          (artifact) =>
            artifact.type === 'cap' &&
            artifact.sweepId === selectedSweep.id &&
            artifact.subType === 'end'
        )
        const wall = [...artifactGraph.values()].find(
          (artifact) =>
            artifact.type === 'wall' && artifact.sweepId === selectedSweep.id
        )
        if (!endCap || !wall || wall.type !== 'wall') {
          throw new Error('Selected body wall and end cap not found')
        }
        const codeRef = getCodeRefsByArtifactId(wall.segId, artifactGraph)?.[0]
        if (!codeRef) throw new Error('Selected edge code reference not found')

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
                codeRef,
              },
            ],
            otherSelections: [],
          },
          radius,
          wasmInstance: instanceInThisFile,
        })
        if (err(result)) throw result

        const newCode = recast(result.modifiedAst, instanceInThisFile)
        if (err(newCode)) throw newCode
        expect(newCode).toMatch(
          new RegExp(`fillet001 = fillet\\(\\s*${bodyName},\\s*edges = \\[`)
        )
        expect(newCode).toContain(`${bodyName}.faces.endCap`)
        expect(newCode).toContain('radius = 1')
        await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
        await kclManagerInThisFile.executeAst({ ast: result.modifiedAst })
        expect(kclManagerInThisFile.errors).toEqual([])
      }
    )

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

    it('should add a fillet call with an algorithm version', async () => {
      const code = `@settings(kclVersion = 2.0, experimentalFeatures = allow)

${extrudedTriangle}`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweepEdge = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge'
      )
      if (!sweepEdge || sweepEdge.type !== 'sweepEdge') {
        throw new Error('sweepEdge artifact not found')
      }
      const selection: Selections = {
        graphSelections: [selectionFromSweepEdge(sweepEdge, artifactGraph)],
        otherSelections: [],
      }
      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const version = (await stringToKclExpression(
        '2',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        version,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode
      expect(newCode).toMatch(/fillet001 = fillet\(\s*extrude001,\s*edges = \[/)
      expect(newCode).toContain('radius = 1')
      expect(newCode).toContain('version = 2')
      expect(newCode).not.toContain('tags =')
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should edit a basic fillet call on sweepEdge', async () => {
      const { artifactGraph, ast, operations } = await getAstAndArtifactGraph(
        extrudedTriangleWithFillet,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const operation = getAllOperations(operations).find(
        (op) => op.type === 'StdLibCall' && op.name === 'fillet'
      )
      if (
        !operation ||
        operation.type !== 'StdLibCall' ||
        !operation.labeledArgs?.tags
      ) {
        throw new Error('Legacy fillet operation or tags argument not found')
      }
      const selection = retrieveEdgeSelectionsFromOpArgs(
        operation.unlabeledArg,
        operation.labeledArgs.tags,
        artifactGraph,
        extrudedTriangleWithFillet
      )
      expect(selection.graphSelections).toHaveLength(1)
      expect(selection.graphSelections[0].entityRef).toMatchObject({
        type: 'edge',
      })
      expect(selection.otherSelections).toEqual([])
      const nodeToEdit = createPathToNodeForLastVariable(ast, false)
      const radius = (await stringToKclExpression(
        '1.1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        extrudedTriangleWithFillet.replace('radius = 1', 'radius = 1.1')
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should edit a piped fillet call on sweepEdge', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-18.43, -11.95])
  |> angledLine(angle = 0, length = 20, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90, length = 20)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg01)
  |> close()
extrude001 = extrude(profile001, length = 20, tagEnd = $capEnd001)
  |> fillet(tags = getCommonEdge(faces = [rectangleSegmentA001, capEnd001]), radius = 2.5)`
      const { artifactGraph, ast, operations } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const operation = getAllOperations(operations).find(
        (op) => op.type === 'StdLibCall' && op.name === 'fillet'
      )
      if (
        !operation ||
        operation.type !== 'StdLibCall' ||
        !operation.labeledArgs?.tags
      ) {
        throw new Error('Legacy fillet operation or tags argument not found')
      }
      const selection = retrieveEdgeSelectionsFromOpArgs(
        operation.unlabeledArg,
        operation.labeledArgs.tags,
        artifactGraph,
        code
      )
      expect(selection.graphSelections).toHaveLength(1)
      expect(selection.graphSelections[0].entityRef).toMatchObject({
        type: 'edge',
      })
      expect(selection.otherSelections).toEqual([])
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [2, 'index'],
        ['declaration', 'VariableDeclaration'],
        ['init', ''],
        ['body', 'PipeExpression'],
        [1, 'index'],
      ]
      const radius = (await stringToKclExpression(
        '2',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(code.replace('radius = 2.5', 'radius = 2'))
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add fillet calls on two bodies from separate sketches', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        twoExtrudedTriangles,
        instanceInThisFile,
        kclManagerInThisFile
      )

      // Get all sweep artifacts (bodies)
      const sweeps = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweep'
      )
      expect(sweeps.length).toBe(2)

      const selection: Selections = {
        graphSelections: sweeps.map((sweep) => {
          const edge = [...artifactGraph.values()].find(
            (artifact) =>
              artifact.type === 'sweepEdge' && artifact.sweepId === sweep.id
          )
          if (!edge || edge.type !== 'sweepEdge') {
            throw new Error('Body sweep edge not found')
          }
          return selectionFromSweepEdge(edge, artifactGraph)
        }),
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
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Should have created two separate fillet calls, one for each body
      expect(newCode).toMatch(/fillet001 = fillet\(\s*extrude001,\s*edges = \[/)
      expect(newCode).toMatch(/fillet002 = fillet\(\s*extrude002,\s*edges = \[/)

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a fillet call to revolve', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        revolvedCShapeWithRectangularProfile,
        instanceInThisFile,
        kclManagerInThisFile
      )

      // Find a sweepEdge from the revolve
      const sweepEdge = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge'
      )
      if (!sweepEdge || sweepEdge.type !== 'sweepEdge') {
        throw new Error('Revolve sweep edge not found')
      }

      const selection: Selections = {
        graphSelections: [selectionFromSweepEdge(sweepEdge, artifactGraph)],
        otherSelections: [],
      }

      const radius = (await stringToKclExpression(
        '0.5',
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

      // Verify the fillet was added
      expect(newCode).toMatch(/fillet001 = fillet\(\s*revolve001,\s*edges = \[/)
      expect(newCode).toContain('radius = 0.5')

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

    it('keeps mixed sweep-edge face references and primitive edges on the same chamfer body', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweep = [...artifactGraph.values()].find((a) => a.type === 'sweep')
      const sweepEdge = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge'
      )
      if (!sweep || !sweepEdge || sweepEdge.type !== 'sweepEdge') {
        throw new Error('Chamfer body or sweep edge not found')
      }

      const selection: Selections = {
        graphSelections: [selectionFromSweepEdge(sweepEdge, artifactGraph)],
        otherSelections: [
          {
            entityId: 'irrelevant-for-this-test',
            parentEntityId: sweep.id,
            primitiveIndex: 0,
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
      expect(result.pathToNode).toHaveLength(2)
      expect(newCode).toContain('edge001 = edgeId(extrude001, index = 0)')
      expect(newCode).toContain(
        'chamfer001 = chamfer(extrude001, tags = edge001, length = 1)'
      )
      expect(newCode).toMatch(
        /chamfer002 = chamfer\(\s*extrude001,\s*edges = \[/
      )
      expect(newCode.match(/length = 1\b/g)).toHaveLength(2)
      expect(newCode).not.toContain('getCommonEdge')
      expect(newCode.indexOf('chamfer001')).toBeLessThan(
        newCode.indexOf('chamfer002')
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      await getAstAndArtifactGraph(
        newCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(kclManagerInThisFile.errors).toEqual([])
    })

    it('should add one chamfer with two face references from a sweep edge and a segment', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweepEdge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      const segment = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'segment'
      )
      if (
        !sweepEdge ||
        sweepEdge.type !== 'sweepEdge' ||
        !segment ||
        segment.type !== 'segment'
      ) {
        throw new Error('Chamfer sweep edge or segment not found')
      }
      const commonFaces = getCommonFacesForEdge(segment, artifactGraph)
      if (err(commonFaces)) throw commonFaces
      expect(commonFaces).toHaveLength(2)
      const selection: Selections = {
        graphSelections: [
          selectionFromSweepEdge(sweepEdge, artifactGraph),
          {
            entityRef: {
              type: 'edge',
              side_faces: commonFaces.map((face) => face.id),
            },
            codeRef: segment.codeRef,
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
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode
      expect(result.pathToNode).toHaveLength(1)
      expect(newCode).toMatch(
        /chamfer001 = chamfer\(\s*extrude001,\s*edges = \[/
      )
      expect(newCode).toContain('length = 1')
      expect(newCode).not.toContain('getCommonEdge')

      const call = getNodeFromPath<CallExpressionKw>(
        result.modifiedAst,
        result.pathToNode[0],
        instanceInThisFile,
        'CallExpressionKw'
      )
      if (err(call)) throw call
      const edges = findKwArg('edges', call.node)
      if (edges?.type !== 'ArrayExpression') {
        throw new Error('Chamfer edge references not found')
      }
      expect(edges.elements).toHaveLength(2)
      expect(edges.elements[0]).not.toEqual(edges.elements[1])
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
    it.each([
      { command: 'fillet', parameter: 'radius' },
      { command: 'chamfer', parameter: 'length' },
    ] as const)(
      'recovers legacy sweep-edge selections and preserves tags when editing $command',
      async ({ command, parameter }) => {
        const code = `@settings(kclVersion = 2.0)
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5)
${command}001 = ${command}(extrude001, tags = [getOppositeEdge(seg01)], ${parameter} = 1)`
        const { ast, artifactGraph, operations } = await getAstAndArtifactGraph(
          code,
          instanceInThisFile,
          kclManagerInThisFile
        )
        expect(kclManagerInThisFile.errors).toEqual([])
        const operation = getAllOperations(operations).find(
          (op) => op.type === 'StdLibCall' && op.name === command
        )
        if (!operation || operation.type !== 'StdLibCall') {
          throw new Error('Edge treatment operation not found')
        }
        const tagsArg = operation.labeledArgs?.tags
        if (!tagsArg || tagsArg.value.type !== 'Array') {
          throw new Error('Legacy tags argument not found')
        }
        const edgeValue = tagsArg.value.value[0]
        if (edgeValue?.type !== 'Uuid') {
          throw new Error('Legacy edge did not evaluate to a UUID')
        }
        const edge = artifactGraph.get(edgeValue.value)
        if (!edge || edge.type !== 'sweepEdge') {
          throw new Error('Legacy UUID did not identify a sweep edge')
        }
        const segment = artifactGraph.get(edge.segId)
        if (!segment || segment.type !== 'segment') {
          throw new Error('Legacy edge source segment not found')
        }

        const selection = retrieveEdgeSelectionsFromOpArgs(
          operation.unlabeledArg,
          tagsArg,
          artifactGraph,
          code
        )
        expect(selection.graphSelections).toEqual([
          {
            entityRef: { type: 'edge', side_faces: edge.commonSurfaceIds },
            codeRef: segment.codeRef,
          },
        ])
        expect(selection.otherSelections).toEqual([])

        const value = (await stringToKclExpression(
          '2',
          rustContextInThisFile
        )) as KclCommandValue
        const editArgs = {
          ast,
          artifactGraph,
          selection,
          nodeToEdit: createPathToNodeForLastVariable(ast, false),
          wasmInstance: instanceInThisFile,
        }
        const result =
          command === 'fillet'
            ? addFillet({ ...editArgs, radius: value })
            : addChamfer({ ...editArgs, length: value })
        if (err(result)) throw result
        const newCode = recast(result.modifiedAst, instanceInThisFile)
        if (err(newCode)) throw newCode
        const expectedCode = recast(
          assertParse(
            code.replace(`${parameter} = 1`, `${parameter} = 2`),
            instanceInThisFile
          ),
          instanceInThisFile
        )
        if (err(expectedCode)) throw expectedCode
        expect(newCode).toBe(expectedCode)
        await kclManagerInThisFile.executeAst({ ast: result.modifiedAst })
        expect(kclManagerInThisFile.errors).toEqual([])
      }
    )

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
        // KCL 3.0 copies of the two multiple-treatment cases above. Under
        // KCL 3.0, fillets and chamfers execute immediately, so each edge
        // lookup is hoisted above the first cut that could consume its edge.
        it(`should delete a piped ${edgeTreatmentType} from a body with multiple treatments under KCL 3.0`, async () => {
          const code = `@settings(kclVersion = "3.0-preview")

sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
baseExtrude = extrude(sketch001, length = -15)
seg01OppositeEdge = getOppositeEdge(seg01)
seg02OppositeEdge = getOppositeEdge(seg02)
extrude001 = baseExtrude
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])
  |> fillet(radius = 5, tags = [seg02OppositeEdge])
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])
chamfer001 = chamfer(extrude001, length = 5, tags = [seg01OppositeEdge])`
          const edgeTreatmentSnippet = `${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])`
          const expectedCode = `@settings(kclVersion = "3.0-preview")

sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
baseExtrude = extrude(sketch001, length = -15)
seg01OppositeEdge = getOppositeEdge(seg01)
seg02OppositeEdge = getOppositeEdge(seg02)
extrude001 = baseExtrude
  |> fillet(radius = 5, tags = [seg02OppositeEdge])
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])
chamfer001 = chamfer(extrude001, length = 5, tags = [seg01OppositeEdge])`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode,
            instanceInThisFile,
            kclManagerInThisFile
          )
        }, 10_000)
        it(`should delete a non-piped ${edgeTreatmentType} from a body with multiple treatments under KCL 3.0`, async () => {
          const code = `@settings(kclVersion = "3.0-preview")

sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
baseExtrude = extrude(sketch001, length = -15)
seg01OppositeEdge = getOppositeEdge(seg01)
seg02OppositeEdge = getOppositeEdge(seg02)
extrude001 = baseExtrude
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])
  |> fillet( radius = 5, tags = [seg02OppositeEdge] )
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])
chamfer001 = chamfer(extrude001, length = 5, tags = [seg01OppositeEdge])`
          const edgeTreatmentSnippet = `fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])`
          const expectedCode = `@settings(kclVersion = "3.0-preview")

sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
baseExtrude = extrude(sketch001, length = -15)
seg01OppositeEdge = getOppositeEdge(seg01)
seg02OppositeEdge = getOppositeEdge(seg02)
extrude001 = baseExtrude
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])
  |> fillet(radius = 5, tags = [seg02OppositeEdge])
chamfer001 = chamfer(extrude001, length = 5, tags = [seg01OppositeEdge])`

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
              id: 'mock-edge-cut-id',
              subType: edgeTreatmentType,
              consumedEdgeId: 'mock-consumed-edge-id',
              edgeIds: [],
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
              id: 'mock-edge-cut-id',
              subType: edgeTreatmentType,
              consumedEdgeId: 'mock-consumed-edge-id',
              edgeIds: [],
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
