import type { KclManager } from '@src/lang/KclManager'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import {
  EdgeTreatmentType,
  addBlend,
  addChamfer,
  addFillet,
  deleteEdgeTreatment,
  groupSelectionsByBodyAndAddTags,
} from '@src/lang/modifyAst/edges'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import { topLevelRange } from '@src/lang/util'
import { type PathToNode, assertParse, recast } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import {
  clonedRegionBody,
  createSelectionFromArtifacts,
  enginelessExecutor,
  getAstAndArtifactGraph,
  getSweepEdgesForBody,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { isOverlap } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  NonCodeSelection,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/network/connectionManager'
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
  const extrudedTriangleWithFillet = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
fillet001 = fillet(extrude001, tags = getCommonEdge(faces = [seg01, extrude001.faces.capEnd001]), radius = 1)`
  const extrudedTriangleWithChamfer = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
chamfer001 = chamfer(extrude001, tags = getCommonEdge(faces = [seg01, extrude001.faces.capEnd001]), length = 1)`
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
  const sketchSolveSweepEdgesAcrossExtrudesForBlend = `sketch001 = sketch(on = XY) {
  line1 = line(start = [var -3.62mm, var -13.65mm], end = [var 3.37mm, var -13.65mm])
  line2 = line(start = [var 3.37mm, var -13.65mm], end = [var 3.37mm, var -10.83mm])
  line3 = line(start = [var 3.37mm, var -10.83mm], end = [var -3.62mm, var -10.83mm])
  line4 = line(start = [var -3.62mm, var -10.83mm], end = [var -3.62mm, var -13.65mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}
hidden001 = hide(sketch001)
region001 = region(point = [-0.125mm, -13.6475mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5, bodyType = SURFACE)

sketch002 = sketch(on = XZ) {
  line1 = line(start = [var -3.45mm, var 10.36mm], end = [var 1.38mm, var 12.93mm])
  line2 = line(start = [var 1.38mm, var 12.93mm], end = [var 5.28mm, var 9.92mm])
  coincident([line1.end, line2.start])
}
hidden002 = hide(sketch002)
extrude002 = extrude([sketch002.line1, sketch002.line2], length = 5, bodyType = SURFACE)
`

  describe('Testing addFillet', () => {
    it('should add a basic fillet call on sweepEdge', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
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
      expect(newCode).toContain(extrudedTriangleWithFillet)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    // https://github.com/KittyCAD/modeling-app/issues/12421
    it('should add a fillet to an edge on a cloned body', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        clonedRegionBody,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const clonedEdge = getSweepEdgesForBody(
        clonedRegionBody,
        'cube2',
        artifactGraph
      ).find((artifact) =>
        artifact.commonSurfaceIds.some(
          (id) => artifactGraph.get(id)?.type === 'cap'
        )
      )
      if (!clonedEdge) {
        throw new Error('Cloned sweep edge artifact not found')
      }
      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection: createSelectionFromArtifacts([clonedEdge], artifactGraph),
        radius,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }
      expect(newCode).toContain('fillet001 = fillet(\n  cube2,')
      expect(newCode).toContain('cube2.sketch.tags.')
      expect(newCode).toContain('cube2.faces.capEnd001')
      expect(newCode).toContain('tagEnd = $capEnd001')
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      await getAstAndArtifactGraph(
        newCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(kclManagerInThisFile.errors).toEqual([])
    })

    // https://github.com/KittyCAD/modeling-app/issues/12420
    it('should qualify an original body cap when a clone follows it', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        clonedRegionBody,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const cloneStart = clonedRegionBody.indexOf('cube2 = clone')
      const originalSweep = [...artifactGraph.values()].find(
        (artifact) =>
          artifact.type === 'sweep' && artifact.codeRef.range[0] < cloneStart
      )
      if (!originalSweep) {
        throw new Error('Original sweep artifact not found')
      }

      const originalEdge = [...artifactGraph.values()].find(
        (artifact) =>
          artifact.type === 'sweepEdge' &&
          artifact.sweepId === originalSweep.id &&
          artifact.commonSurfaceIds.some(
            (id) => artifactGraph.get(id)?.type === 'cap'
          )
      )
      if (!originalEdge) {
        throw new Error('Original sweep edge artifact not found')
      }

      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection: createSelectionFromArtifacts([originalEdge], artifactGraph),
        radius,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }
      expect(newCode).toContain('cube1.faces.capEnd001')
      expect(newCode).toContain('tagEnd = $capEnd001')
      await getAstAndArtifactGraph(
        newCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(kclManagerInThisFile.errors).toEqual([])
    })

    it('should add a fillet to the post-subtract body when selecting the original box edge', async () => {
      const code = `@settings(defaultLengthUnit = mm, kclVersion = 1.0)

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

      const sweepEdge = [...artifactGraph.values()].find(
        (artifact) =>
          artifact.type === 'sweepEdge' && artifact.sweepId === boxSweep.id
      )
      if (!sweepEdge) {
        throw new Error('boxSolid sweepEdge artifact not found')
      }

      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection: createSelectionFromArtifacts([sweepEdge], artifactGraph),
        radius,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `fillet001 = fillet(
  part,
  tags = getCommonEdge(faces = [
    boxRegion.tags.topEdge,
    part.faces.capEnd001
  ]),
  radius = 1,
)`
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
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

    it('should add a basic fillet call on a sweepEdge and a segment', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweepEdge = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge'
      )!
      const segment = [...artifactGraph.values()].find(
        (a) => a.type === 'segment'
      )!
      const selection = createSelectionFromArtifacts(
        [sweepEdge, segment],
        artifactGraph
      )
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
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(
  profile001,
  length = 5,
  tagEnd = $capEnd001,
  tagStart = $capStart001,
)
fillet001 = fillet(
  extrude001,
  tags = [
    getCommonEdge(faces = [seg01, extrude001.faces.capEnd001]),
    getCommonEdge(faces = [seg01, extrude001.faces.capStart001])
  ],
  radius = 1,
)`)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should group edges from different operands by their resolved boolean body', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> close()
extrude001 = extrude(profile001, length = 10)

sketch002 = startSketchOn(XY)
profile002 = startProfile(sketch002, at = [2, 2])
  |> xLine(length = 4)
  |> yLine(length = 4)
  |> xLine(length = -4)
  |> close()
extrude002 = extrude(profile002, length = 10)
part = subtract(extrude001, tools = extrude002)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweeps = [...artifactGraph.values()].filter(
        (artifact) => artifact.type === 'sweep'
      )
      const edges = sweeps
        .slice(0, 2)
        .map((sweep) =>
          [...artifactGraph.values()].find(
            (artifact) =>
              artifact.type === 'sweepEdge' && artifact.sweepId === sweep.id
          )
        )
      if (!edges[0] || !edges[1]) {
        throw new Error('Expected one edge from each boolean operand')
      }

      const result = groupSelectionsByBodyAndAddTags(
        createSelectionFromArtifacts([edges[0], edges[1]], artifactGraph),
        artifactGraph,
        ast,
        instanceInThisFile
      )
      if (err(result)) throw result
      expect(result.bodies.size).toBe(1)
    })

    it('should add a basic fillet call with tag on sweepEdge', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
      const radius = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addFillet({
        ast,
        artifactGraph,
        selection,
        radius,
        tag: 'myTag',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
fillet001 = fillet(
  extrude001,
  tags = getCommonEdge(faces = [seg01, extrude001.faces.capEnd001]),
  radius = 1,
  tag = $myTag,
)`
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a fillet call with an algorithm version', async () => {
      const code = `@settings(experimentalFeatures = allow)

${extrudedTriangle}`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweepEdge = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge'
      )
      if (!sweepEdge) {
        throw new Error('sweepEdge artifact not found')
      }
      const selection = createSelectionFromArtifacts([sweepEdge], artifactGraph)
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
      expect(newCode).toContain(`fillet001 = fillet(
  extrude001,
  tags = getCommonEdge(faces = [seg01, extrude001.faces.capEnd001]),
  radius = 1,
  version = 2,
)`)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should edit a basic fillet call on sweepEdge', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangleWithFillet,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
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
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweepEdge = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge'
      )
      if (!sweepEdge) {
        throw new Error('sweepEdge artifact not found')
      }
      const selection = createSelectionFromArtifacts([sweepEdge], artifactGraph)
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
      expect(newCode).toContain(
        code.replace(
          '  |> fillet(tags = getCommonEdge(faces = [rectangleSegmentA001, capEnd001]), radius = 2.5)',
          `  |> fillet(
       tags = getCommonEdge(faces = [
         rectangleSegmentA001,
         %.faces.capEnd001
       ]),
       radius = 2,
     )`
        )
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add fillet calls on two bodies with one edge selected on each', async () => {
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

      // Get sweep edges from each body
      const sweepEdgesBody1 = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweepEdge' && a.sweepId === sweeps[0].id
      )
      const sweepEdgesBody2 = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweepEdge' && a.sweepId === sweeps[1].id
      )

      expect(sweepEdgesBody1.length).toBeGreaterThan(0)
      expect(sweepEdgesBody2.length).toBeGreaterThan(0)

      const selection = createSelectionFromArtifacts(
        [sweepEdgesBody1[0], sweepEdgesBody2[0]],
        artifactGraph
      )

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
      expect(newCode).toContain('fillet001 = fillet(extrude001')
      expect(newCode).toContain('fillet002 = fillet(extrude002')

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
      )!

      const selection = createSelectionFromArtifacts([sweepEdge], artifactGraph)

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
      expect(newCode).toContain('fillet001 = fillet(revolve001')
      expect(newCode).toContain('radius = 0.5')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addChamfer', () => {
    it('should add a basic chamfer call on sweepEdge', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
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
      expect(newCode).toContain(extrudedTriangleWithChamfer)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
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

    it('should add a basic chamfer call on a sweepEdge and a segment', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweepEdge = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge'
      )!
      const segment = [...artifactGraph.values()].find(
        (a) => a.type === 'segment'
      )!
      const selection = createSelectionFromArtifacts(
        [sweepEdge, segment],
        artifactGraph
      )
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
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(
  profile001,
  length = 5,
  tagEnd = $capEnd001,
  tagStart = $capStart001,
)
chamfer001 = chamfer(
  extrude001,
  tags = [
    getCommonEdge(faces = [seg01, extrude001.faces.capEnd001]),
    getCommonEdge(faces = [seg01, extrude001.faces.capStart001])
  ],
  length = 1,
)`)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a chamfer call on sweepEdge with two lengths', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
      const length = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const secondLength = (await stringToKclExpression(
        '1.1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        secondLength,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
chamfer001 = chamfer(
  extrude001,
  tags = getCommonEdge(faces = [seg01, extrude001.faces.capEnd001]),
  length = 1,
  secondLength = 1.1,
)`)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a chamfer call on sweepEdge with one length and one angle, and a tag', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangle,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
      const length = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const angle = (await stringToKclExpression(
        '46deg',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        angle,
        tag: 'myChamferTag',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $capEnd001)
chamfer001 = chamfer(
  extrude001,
  tags = getCommonEdge(faces = [seg01, extrude001.faces.capEnd001]),
  length = 1,
  angle = 46deg,
  tag = $myChamferTag,
)`)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a chamfer call with an algorithm version', async () => {
      const code = `@settings(experimentalFeatures = allow)

${extrudedTriangle}`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweepEdge = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge'
      )
      if (!sweepEdge) {
        throw new Error('sweepEdge artifact not found')
      }
      const selection = createSelectionFromArtifacts([sweepEdge], artifactGraph)
      const length = (await stringToKclExpression(
        '1',
        rustContextInThisFile
      )) as KclCommandValue
      const version = (await stringToKclExpression(
        '2',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        version,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`chamfer001 = chamfer(
  extrude001,
  tags = getCommonEdge(faces = [seg01, extrude001.faces.capEnd001]),
  length = 1,
  version = 2,
)`)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should edit a basic chamfer call on sweepEdge', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        extrudedTriangleWithChamfer,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selection = createSelectionFromArtifacts(
        [[...artifactGraph.values()].find((a) => a.type === 'sweepEdge')!],
        artifactGraph
      )
      const nodeToEdit = createPathToNodeForLastVariable(ast, false)
      const length = (await stringToKclExpression(
        '1.1',
        rustContextInThisFile
      )) as KclCommandValue
      const result = addChamfer({
        ast,
        artifactGraph,
        selection,
        length,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        extrudedTriangleWithChamfer.replace('length = 1', 'length = 1.1')
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add chamfer calls on two bodies with one edge selected on each', async () => {
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

      // Get sweep edges from each body
      const sweepEdgesBody1 = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweepEdge' && a.sweepId === sweeps[0].id
      )
      const sweepEdgesBody2 = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweepEdge' && a.sweepId === sweeps[1].id
      )

      expect(sweepEdgesBody1.length).toBeGreaterThan(0)
      expect(sweepEdgesBody2.length).toBeGreaterThan(0)

      const selection = createSelectionFromArtifacts(
        [sweepEdgesBody1[0], sweepEdgesBody2[0]],
        artifactGraph
      )

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

      // Should have created two separate chamfer calls, one for each body
      expect(newCode).toContain('chamfer001 = chamfer(extrude001')
      expect(newCode).toContain('chamfer002 = chamfer(extrude002')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a chamfer call to revolve', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        revolvedCShapeWithRectangularProfile,
        instanceInThisFile,
        kclManagerInThisFile
      )

      // Find a sweepEdge from the revolve
      const sweepEdge = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge'
      )!

      const selection = createSelectionFromArtifacts([sweepEdge], artifactGraph)

      const length = (await stringToKclExpression(
        '0.5',
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

      // Verify the chamfer was added
      expect(newCode).toContain('chamfer001 = chamfer(revolve001')
      expect(newCode).toContain('length = 0.5')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addBlend', () => {
    it('should build bounded edges against a cloned body', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        clonedRegionBody,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const clonedEdges = getSweepEdgesForBody(
        clonedRegionBody,
        'cube2',
        artifactGraph
      ).slice(0, 2)
      if (clonedEdges.length !== 2) {
        throw new Error('Expected two cloned sweep edges')
      }

      const result = addBlend({
        ast,
        artifactGraph,
        edges: createSelectionFromArtifacts(clonedEdges, artifactGraph),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode
      expect(newCode.match(/getBoundedEdge\(cube2,/g)?.length).toBe(2)
      expect(newCode).toContain('cube2.sketch.tags.')
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

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

      const sweepEdgeBody1 = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge' && a.sweepId === sweeps[0].id
      )
      const sweepEdgeBody2 = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge' && a.sweepId === sweeps[1].id
      )
      if (
        !sweepEdgeBody1 ||
        sweepEdgeBody1.type !== 'sweepEdge' ||
        !sweepEdgeBody2 ||
        sweepEdgeBody2.type !== 'sweepEdge'
      ) {
        throw new Error(
          'Could not find sweep edges for sketch solve blend test'
        )
      }

      const segmentBody1 = artifactGraph.get(sweepEdgeBody1.segId)
      const segmentBody2 = artifactGraph.get(sweepEdgeBody2.segId)
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

    async function runAddBlendAndCheckCode(
      secondEdgeIndex: number,
      secondEdgeExpr: string
    ) {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        sketchSolveSweepEdgesAcrossExtrudesForBlend,
        instanceInThisFile,
        kclManagerInThisFile
      )

      const sweeps = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweep'
      )
      expect(sweeps.length).toBe(2)

      const sweepEdgeBody1 = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge' && a.sweepId === sweeps[0].id
      )
      const sweepEdgeBody2 = [...artifactGraph.values()].filter(
        (a) =>
          (a.type === 'sweepEdge' && a.sweepId === sweeps[1].id) ||
          (a.type === 'segment' && a.pathId === sweeps[1].pathId)
      )[secondEdgeIndex]
      console.log('sweepEdgeBody2', sweepEdgeBody2)
      if (
        !sweepEdgeBody1 ||
        sweepEdgeBody1.type !== 'sweepEdge' ||
        !sweepEdgeBody2 ||
        !(
          sweepEdgeBody2.type === 'sweepEdge' ||
          sweepEdgeBody2.type === 'segment'
        )
      ) {
        throw new Error(
          'Could not find one sweep edge per extrude for blend test'
        )
      }

      const edges = createSelectionFromArtifacts(
        [sweepEdgeBody1, sweepEdgeBody2],
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
      expect(newCode).toContain(`blend001 = blend([
  getBoundedEdge(extrude001, edge = getOppositeEdge(region001.tags.line1)),
  getBoundedEdge(extrude002, edge = ${secondEdgeExpr})
])`)

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    }

    it('should add a blend call from two sweepEdges selected across two multi-segment extrudes - first segment', async () => {
      await runAddBlendAndCheckCode(0, 'extrude002.sketch.tags.line1')
    })

    it('should add a blend call from two sweepEdges selected across two multi-segment extrudes - second segment', async () => {
      await runAddBlendAndCheckCode(1, 'extrude002.sketch.tags.line2')
    })

    it('should add a blend call from two sweepEdges selected across two multi-segment extrudes - first sweepEdge', async () => {
      await runAddBlendAndCheckCode(
        2,
        'getOppositeEdge(extrude002.sketch.tags.line1)'
      )
    })

    it('should add a blend call from two sweepEdges selected across two multi-segment extrudes - second sweepEdge', async () => {
      await runAddBlendAndCheckCode(
        3,
        'getNextAdjacentEdge(extrude002.sketch.tags.line1)'
      )
    })

    it('should add a blend call from two sweepEdges selected across two multi-segment extrudes - third sweepEdge', async () => {
      await runAddBlendAndCheckCode(
        4,
        'getOppositeEdge(extrude002.sketch.tags.line2)'
      )
    })

    it('should add a blend call from two sweepEdges selected across two multi-segment extrudes - fourth sweepEdge', async () => {
      await runAddBlendAndCheckCode(
        5,
        'getNextAdjacentEdge(extrude002.sketch.tags.line2)'
      )
    })

    it('should add a blend call with a sweepEdge coming from a region extrude', async () => {
      const code = `sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 6.16mm, var 0mm])
  line2 = line(start = [var 6.16mm, var 0mm], end = [var 6.16mm, var 5.46mm])
  line3 = line(start = [var 6.16mm, var 5.46mm], end = [var 0mm, var 5.46mm])
  line4 = line(start = [var 0mm, var 5.46mm], end = [var 0mm, var 0mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
  coincident([line1.start, ORIGIN])
}
hidden001 = hide(sketch001)
region001 = region(point = [3.08mm, 0.0025mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5, bodyType = SURFACE)
sketch002 = sketch(on = -YZ) {
  line1 = line(start = [var -5.51mm, var 8.29mm], end = [var 0mm, var 8.04mm])
  vertical([line1.end, ORIGIN])
  horizontal(line1)
}
extrude002 = extrude(sketch002.line1, length = 5, bodyType = SURFACE)
hidden002 = hide(sketch002)
surface001 = flipSurface(extrude002)
`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )

      const sweeps = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweep'
      )
      expect(sweeps.length).toBe(2)

      const sweepEdgeBody1 = [...artifactGraph.values()]
        .filter((a) => a.type === 'sweepEdge' && a.sweepId === sweeps[0].id)
        .at(-6)
      const segmentBody2 = [...artifactGraph.values()].find(
        (a) => a.type === 'segment' && a.pathId === sweeps[1].pathId
      )

      if (!sweepEdgeBody1 || !segmentBody2) {
        throw new Error(
          'Could not find the requested sweep edges for blend insertion'
        )
      }

      const edges = createSelectionFromArtifacts(
        [segmentBody2, sweepEdgeBody1],
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
  getBoundedEdge(extrude002, edge = extrude002.sketch.tags.line1),
  getBoundedEdge(extrude001, edge = getOppositeEdge(region001.tags.line2))
])`
      )

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a blend call with opposite wrappers from sweep edges', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        sketchSolveSurfacesForBlend,
        instanceInThisFile,
        kclManagerInThisFile
      )

      const sweeps = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweep'
      )
      expect(sweeps.length).toBe(2)

      const oppositeEdgeBody1 = [...artifactGraph.values()].find(
        (a) =>
          a.type === 'sweepEdge' &&
          a.sweepId === sweeps[0].id &&
          a.subType === 'opposite'
      )
      const oppositeEdgeBody2 = [...artifactGraph.values()].find(
        (a) =>
          a.type === 'sweepEdge' &&
          a.sweepId === sweeps[1].id &&
          a.subType === 'opposite'
      )

      const edges = createSelectionFromArtifacts(
        [oppositeEdgeBody1!, oppositeEdgeBody2!],
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
  getBoundedEdge(extrude001, edge = getOppositeEdge(extrude001.sketch.tags.line1)),
  getBoundedEdge(extrude002, edge = getOppositeEdge(extrude002.sketch.tags.line1))
])`
      )

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a blend call with next-adjacent wrappers from sweep edges', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        sketchSolveSurfacesForBlend,
        instanceInThisFile,
        kclManagerInThisFile
      )

      const sweeps = [...artifactGraph.values()].filter(
        (a) => a.type === 'sweep'
      )
      expect(sweeps.length).toBe(2)

      const adjacentEdgeBody1 = [...artifactGraph.values()].find(
        (a) =>
          a.type === 'sweepEdge' &&
          a.sweepId === sweeps[0].id &&
          a.subType === 'adjacent'
      )
      const adjacentEdgeBody2 = [...artifactGraph.values()].find(
        (a) =>
          a.type === 'sweepEdge' &&
          a.sweepId === sweeps[1].id &&
          a.subType === 'adjacent'
      )

      const edges = createSelectionFromArtifacts(
        [adjacentEdgeBody1!, adjacentEdgeBody2!],
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
  getBoundedEdge(extrude001, edge = getNextAdjacentEdge(extrude001.sketch.tags.line1)),
  getBoundedEdge(extrude002, edge = getNextAdjacentEdge(extrude002.sketch.tags.line1))
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

      const singleEdge = [...artifactGraph.values()].find(
        (a) => a.type === 'sweepEdge'
      )!
      const edges = createSelectionFromArtifacts([singleEdge], artifactGraph)

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
      if (!('codeRef' in artifact)) return false
      return isOverlap(artifact.codeRef.range, edgeTreatmentRange)
    })

    // build selection
    const selection: Selection = {
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
  |> fillet(radius = 5, tags = [getOppositeEdge(seg02)])
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
          const selection: Selection = {
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
          const selection: Selection = {
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
