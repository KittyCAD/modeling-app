import type { KclManager } from '@src/lang/KclManager'
import {
  addAngularityGdt,
  addAnnotationGdt,
  addCircularityGdt,
  addConcentricityGdt,
  addCylindricityGdt,
  addDatumGdt,
  addDistanceGdt,
  addFlatnessGdt,
  addNoteGdt,
  addParallelismGdt,
  addPerpendicularityGdt,
  addPositionGdt,
  addProfileGdt,
  addRunoutGdt,
  addStraightnessGdt,
  addSymmetryGdt,
  getNextAvailableDatumName,
  getUsedDatumNames,
} from '@src/lang/modifyAst/gdt'
import { type ArtifactGraph, assertParse, recast } from '@src/lang/wasm'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import {
  clonedRegionBody,
  createSelectionFromArtifacts,
  enginelessExecutor,
  getCapFromCylinder,
  getSweepEdgesForBody,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/network/connectionManager'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
let kclManagerInThisFile: KclManager = null!
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

  const { instance, kclManager, engineCommandManager, rustContext } =
    await buildTheWorldAndConnectToEngine()
  instanceInThisFile = instance
  kclManagerInThisFile = kclManager
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})
afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
})

const executeCode = async (
  code: string,
  instance: ModuleType,
  kclManager: KclManager
) => {
  const ast = assertParse(code, instance)
  await kclManager.executeAst({ ast })
  const artifactGraph = kclManager.artifactGraph
  await new Promise((resolve) => setTimeout(resolve, 100))
  return { ast, artifactGraph }
}

function getWallsFromBox(artifactGraph: ArtifactGraph, count: number) {
  const walls = [...artifactGraph.values()]
    .filter((a) => a.type === 'wall')
    .slice(0, count)
  return createSelectionFromArtifacts(walls, artifactGraph)
}

function getEndCapsFromMultipleBodies(artifactGraph: ArtifactGraph) {
  const endCaps = [...artifactGraph.values()].filter(
    (a) => a.type === 'cap' && a.subType === 'end'
  )
  return createSelectionFromArtifacts(endCaps, artifactGraph)
}

async function getKclCommandValue(
  value: string,
  instance: ModuleType,
  rustContext: RustContext
) {
  const result = await stringToKclExpression(value, rustContext, {
    allowArrays: true,
    allowStringArrays: true,
  })
  if (err(result) || 'errors' in result) {
    throw new Error('Failed to create KCL expression')
  }
  return result
}

describe('gdt.spec.ts', () => {
  const boxWithOneTagAndChamfer = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
  |> chamfer(
       length = 1,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
     )`

  const cylinder = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 10)
extrude001 = extrude(profile001, length = 10)`

  const box = `sketch002 = startSketchOn(XY)
profile002 = startProfile(sketch002, at = [0, 0])
  |> xLine(length = 10)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(profile002, length = 10)`

  const twoBodies = `sketch003 = startSketchOn(XY)
profile003 = circle(sketch003, center = [0, 0], radius = 5)
extrude003 = extrude(profile003, length = 8)

sketch004 = startSketchOn(XY)
profile004 = circle(sketch004, center = [15, 0], radius = 5)
extrude004 = extrude(profile004, length = 8)`

  // Test data: Creates a box with a fillet on one edge for GDT testing
  const boxWithOneTagAndFillet = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
  |> fillet(
        radius = 1,
        tags = [
          getCommonEdge(faces = [seg01, capEnd001])
        ],
      )`

  describe('Testing addFlatnessGdt', () => {
    it('should add a basic flatness annotation to a single face (cap)', async () => {
      const { artifactGraph, ast } = await executeCode(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getCapFromCylinder(artifactGraph)
      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addFlatnessGdt({
        ast,
        artifactGraph,
        faces,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify the extrude was tagged
      expect(newCode).toContain('tagEnd = $capEnd001')
      // Verify the GDT annotation was added
      expect(newCode).toContain(
        'gdt::flatness(faces = [capEnd001], tolerance = 0.1mm)'
      )

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add flatness annotations to multiple faces', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getWallsFromBox(artifactGraph, 3)

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addFlatnessGdt({
        ast,
        artifactGraph,
        faces,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify all three segments were tagged
      expect(newCode).toContain('tag = $seg01')
      expect(newCode).toContain('tag = $seg02')
      expect(newCode).toContain('tag = $seg03')
      // Should create three separate GDT annotations (one per face)
      const gdtCalls = newCode.match(/gdt::flatness/g)
      expect(gdtCalls).toHaveLength(3)
      // Verify each face has its own annotation
      expect(newCode).toContain('faces = [seg01], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [seg02], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [seg03], tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add flatness annotations to different bodies', async () => {
      const { artifactGraph, ast } = await executeCode(
        twoBodies,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getEndCapsFromMultipleBodies(artifactGraph)

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addFlatnessGdt({
        ast,
        artifactGraph,
        faces,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify both extrudes were tagged
      expect(newCode).toContain('tagEnd = $capEnd001')
      expect(newCode).toContain('tagEnd = $capEnd002')
      // Should create two separate GDT annotations (one per body)
      const gdtCalls = newCode.match(/gdt::flatness/g)
      expect(gdtCalls).toHaveLength(2)
      // Verify each face has its own annotation
      expect(newCode).toContain('faces = [capEnd001], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [capEnd002], tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should not create duplicate annotations when same face is selected multiple times', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const walls = getWallsFromBox(artifactGraph, 3)

      // Manually duplicate one face in the selection
      const duplicatedSelection: Selections = {
        graphSelections: [
          ...walls.graphSelections,
          walls.graphSelections[0], // Add first wall again
        ],
        otherSelections: [],
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addFlatnessGdt({
        ast,
        artifactGraph,
        faces: duplicatedSelection,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Should still only have 3 GDT calls (deduplication within selection works)
      const tagMatches = newCode.match(/tag = \$seg\d+/g)
      expect(tagMatches).toHaveLength(3)
      const gdtCalls = newCode.match(/gdt::flatness/g)
      expect(gdtCalls).toHaveLength(3)
      expect(newCode).toContain('faces = [seg01], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [seg02], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [seg03], tolerance = 0.1mm')
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should allow adding another annotation to the same face', async () => {
      const { artifactGraph, ast } = await executeCode(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getCapFromCylinder(artifactGraph)

      // Add first annotation
      const tolerance1 = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result1 = addFlatnessGdt({
        ast,
        artifactGraph,
        faces,
        tolerance: tolerance1,
        wasmInstance: instanceInThisFile,
      })
      if (err(result1)) throw result1

      await enginelessExecutor(result1.modifiedAst, rustContextInThisFile)

      // Add second annotation to the same face
      const tolerance2 = await getKclCommandValue(
        '0.2mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result2 = addFlatnessGdt({
        ast: result1.modifiedAst,
        artifactGraph,
        faces,
        tolerance: tolerance2,
        wasmInstance: instanceInThisFile,
      })
      if (err(result2)) throw result2

      const newCode = recast(result2.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify tag appears only once
      expect(newCode.match(/tagEnd/g)).toHaveLength(1)
      // Should have TWO GDT calls
      const gdtCalls = newCode.match(/gdt::flatness/g)
      expect(gdtCalls).toHaveLength(2)
      expect(newCode).toContain('faces = [capEnd001], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [capEnd001], tolerance = 0.2mm')

      await enginelessExecutor(result2.modifiedAst, rustContextInThisFile)
    })

    it('should add flatness annotation with all optional parameters', async () => {
      const { artifactGraph, ast } = await executeCode(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getCapFromCylinder(artifactGraph)

      // Create all parameter values
      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const precision = await getKclCommandValue(
        '3',
        instanceInThisFile,
        rustContextInThisFile
      )
      const framePosition = await getKclCommandValue(
        '[10, 20]',
        instanceInThisFile,
        rustContextInThisFile
      )
      const framePlane = 'XY'
      const fontSize = await getKclCommandValue(
        '10mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const leaderScale = await getKclCommandValue(
        '1.2',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addFlatnessGdt({
        ast,
        artifactGraph,
        faces,
        tolerance,
        precision,
        framePosition,
        framePlane,
        leaderScale,
        fontSize,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify the extrude was tagged
      expect(newCode).toContain('tagEnd = $capEnd001')
      // Verify all parameters are in the GDT call
      expect(newCode).toContain('faces = [capEnd001]')
      expect(newCode).toContain('tolerance = 0.1mm')
      expect(newCode).toContain('precision = 3')
      expect(newCode).toContain('framePosition = [10, 20]')
      expect(newCode).toContain('framePlane = XY')
      expect(newCode).toContain('fontSize = 10mm')
      expect(newCode).toContain('leaderScale = 1.2')
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should place GDT annotations at the end of the file', async () => {
      const { artifactGraph, ast } = await executeCode(
        twoBodies,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getEndCapsFromMultipleBodies(artifactGraph)

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addFlatnessGdt({
        ast,
        artifactGraph,
        faces,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify GDT calls come after all model code
      const lastExtrudeIndex = newCode.lastIndexOf('extrude')
      const firstGdtIndex = newCode.indexOf('gdt::flatness')
      expect(firstGdtIndex).toBeGreaterThan(lastExtrudeIndex)

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a flatness annotation to an edgeCut (chamfer) face', async () => {
      const { artifactGraph, ast } = await executeCode(
        boxWithOneTagAndChamfer,
        instanceInThisFile,
        kclManagerInThisFile
      )

      // Find the edgeCut artifact created by the chamfer operation
      const edgeCutArtifact = [...artifactGraph.values()].find(
        (a) => a.type === 'edgeCut'
      )
      expect(edgeCutArtifact).toBeDefined()

      // Create selection for the edgeCut face
      const faces = createSelectionFromArtifacts(
        [edgeCutArtifact!],
        artifactGraph
      )

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addFlatnessGdt({
        ast,
        artifactGraph,
        faces,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify the original segment tag is preserved and chamfer gets new tag
      expect(newCode).toContain('tag = $seg01')
      expect(newCode).toContain('tag = $seg02')
      // Verify the GDT annotation references the chamfer tag
      expect(newCode).toContain(
        'gdt::flatness(faces = [seg02], tolerance = 0.1mm)'
      )
      // Verify the original chamfer operation is still there
      expect(newCode).toContain('chamfer(')
      expect(newCode).toContain('getCommonEdge(faces = [seg01, capEnd001])')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should successfully add a fillet GDT annotation (tests end-to-end integration)', async () => {
      const { artifactGraph, ast } = await executeCode(
        boxWithOneTagAndFillet,
        instanceInThisFile,
        kclManagerInThisFile
      )

      // Find the fillet edgeCut artifact
      const filletArtifact = [...artifactGraph.values()].find(
        (a) => a.type === 'edgeCut' && a.subType === 'fillet'
      )
      expect(filletArtifact).toBeDefined()
      if (!filletArtifact) {
        throw new Error('Expected fillet artifact not found')
      }

      // Create selections for GDT
      const faces = createSelectionFromArtifacts(
        [filletArtifact],
        artifactGraph
      )

      // Test the full GDT workflow
      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )

      const result = addFlatnessGdt({
        ast,
        artifactGraph,
        faces,
        tolerance,
        wasmInstance: instanceInThisFile,
      })

      if (err(result)) throw result
      const { modifiedAst } = result
      const newCode = recast(modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify GDT annotation was added for fillet
      expect(newCode).toContain('gdt::flatness(')
      expect(newCode).toContain('faces = [seg02]') // The tagged fillet face
      expect(newCode).toContain('tolerance = 0.1mm')

      // Verify the fillet was tagged properly
      expect(newCode).toContain('tag = $seg02')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addStraightnessGdt', () => {
    it('should add a basic straightness annotation to a single face (cap)', async () => {
      const { artifactGraph, ast } = await executeCode(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const objects = getCapFromCylinder(artifactGraph)
      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addStraightnessGdt({
        ast,
        artifactGraph,
        objects,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      expect(newCode).toContain('tagEnd = $capEnd001')
      expect(newCode).toContain(
        'gdt::straightness(faces = [capEnd001], tolerance = 0.1mm)'
      )

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add straightness annotations to multiple faces', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const objects = getWallsFromBox(artifactGraph, 3)

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addStraightnessGdt({
        ast,
        artifactGraph,
        objects,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      expect(newCode).toContain('tag = $seg01')
      expect(newCode).toContain('tag = $seg02')
      expect(newCode).toContain('tag = $seg03')
      const gdtCalls = newCode.match(/gdt::straightness/g)
      expect(gdtCalls).toHaveLength(3)
      expect(newCode).toContain('faces = [seg01], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [seg02], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [seg03], tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add straightness annotations to selected faces and edges', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const face = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'cap'
      )
      const edge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      if (!face || !edge) {
        throw new Error('Expected a cap face and sweep edge')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addStraightnessGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([face, edge], artifactGraph),
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      expect(newCode).toContain('gdt::straightness(')
      expect(newCode).toContain('faces = [')
      expect(newCode).toContain('edges = [')
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add straightness annotation with all optional parameters', async () => {
      const { artifactGraph, ast } = await executeCode(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const objects = getCapFromCylinder(artifactGraph)

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const precision = await getKclCommandValue(
        '3',
        instanceInThisFile,
        rustContextInThisFile
      )
      const framePosition = await getKclCommandValue(
        '[10, 20]',
        instanceInThisFile,
        rustContextInThisFile
      )
      const framePlane = 'XY'
      const fontSize = await getKclCommandValue(
        '10mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const leaderScale = await getKclCommandValue(
        '1.2',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addStraightnessGdt({
        ast,
        artifactGraph,
        objects,
        tolerance,
        precision,
        framePosition,
        framePlane,
        leaderScale,
        fontSize,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      expect(newCode).toContain('tagEnd = $capEnd001')
      expect(newCode).toContain('faces = [capEnd001]')
      expect(newCode).toContain('tolerance = 0.1mm')
      expect(newCode).toContain('precision = 3')
      expect(newCode).toContain('framePosition = [10, 20]')
      expect(newCode).toContain('framePlane = XY')
      expect(newCode).toContain('fontSize = 10mm')
      expect(newCode).toContain('leaderScale = 1.2')
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addCircularityGdt', () => {
    it('should add a basic circularity annotation to a single face (cap)', async () => {
      const { artifactGraph, ast } = await executeCode(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const objects = getCapFromCylinder(artifactGraph)
      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addCircularityGdt({
        ast,
        artifactGraph,
        objects,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      expect(newCode).toContain('tagEnd = $capEnd001')
      expect(newCode).toContain(
        'gdt::circularity(faces = [capEnd001], tolerance = 0.1mm)'
      )

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add circularity annotations to multiple faces', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const objects = getWallsFromBox(artifactGraph, 3)

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addCircularityGdt({
        ast,
        artifactGraph,
        objects,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      expect(newCode).toContain('tag = $seg01')
      expect(newCode).toContain('tag = $seg02')
      expect(newCode).toContain('tag = $seg03')
      const gdtCalls = newCode.match(/gdt::circularity/g)
      expect(gdtCalls).toHaveLength(3)
      expect(newCode).toContain('faces = [seg01], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [seg02], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [seg03], tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add circularity annotations to selected faces and edges', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const face = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'cap'
      )
      const edge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      if (!face || !edge) {
        throw new Error('Expected a cap face and sweep edge')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addCircularityGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([face, edge], artifactGraph),
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      expect(newCode).toContain('gdt::circularity(')
      expect(newCode).toContain('faces = [')
      expect(newCode).toContain('edges = [')
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add circularity annotation with all optional parameters', async () => {
      const { artifactGraph, ast } = await executeCode(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const objects = getCapFromCylinder(artifactGraph)

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const precision = await getKclCommandValue(
        '3',
        instanceInThisFile,
        rustContextInThisFile
      )
      const framePosition = await getKclCommandValue(
        '[10, 20]',
        instanceInThisFile,
        rustContextInThisFile
      )
      const framePlane = 'XY'
      const fontSize = await getKclCommandValue(
        '10mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const leaderScale = await getKclCommandValue(
        '1.2',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addCircularityGdt({
        ast,
        artifactGraph,
        objects,
        tolerance,
        precision,
        framePosition,
        framePlane,
        leaderScale,
        fontSize,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      expect(newCode).toContain('tagEnd = $capEnd001')
      expect(newCode).toContain('faces = [capEnd001]')
      expect(newCode).toContain('tolerance = 0.1mm')
      expect(newCode).toContain('precision = 3')
      expect(newCode).toContain('framePosition = [10, 20]')
      expect(newCode).toContain('framePlane = XY')
      expect(newCode).toContain('fontSize = 10mm')
      expect(newCode).toContain('leaderScale = 1.2')
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addCylindricityGdt', () => {
    it('should add a basic cylindricity annotation to a single face (cap)', async () => {
      const { artifactGraph, ast } = await executeCode(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const objects = getCapFromCylinder(artifactGraph)
      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addCylindricityGdt({
        ast,
        artifactGraph,
        objects,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      expect(newCode).toContain('tagEnd = $capEnd001')
      expect(newCode).toContain(
        'gdt::cylindricity(faces = [capEnd001], tolerance = 0.1mm)'
      )

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add cylindricity annotations to multiple faces', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const objects = getWallsFromBox(artifactGraph, 3)

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addCylindricityGdt({
        ast,
        artifactGraph,
        objects,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      expect(newCode).toContain('tag = $seg01')
      expect(newCode).toContain('tag = $seg02')
      expect(newCode).toContain('tag = $seg03')
      const gdtCalls = newCode.match(/gdt::cylindricity/g)
      expect(gdtCalls).toHaveLength(3)
      expect(newCode).toContain('faces = [seg01], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [seg02], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [seg03], tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add cylindricity annotations to selected faces and edges', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const face = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'cap'
      )
      const edge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      if (!face || !edge) {
        throw new Error('Expected a cap face and sweep edge')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addCylindricityGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([face, edge], artifactGraph),
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      expect(newCode).toContain('gdt::cylindricity(')
      expect(newCode).toContain('faces = [')
      expect(newCode).toContain('edges = [')
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add cylindricity annotation with all optional parameters', async () => {
      const { artifactGraph, ast } = await executeCode(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const objects = getCapFromCylinder(artifactGraph)

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const precision = await getKclCommandValue(
        '3',
        instanceInThisFile,
        rustContextInThisFile
      )
      const framePosition = await getKclCommandValue(
        '[10, 20]',
        instanceInThisFile,
        rustContextInThisFile
      )
      const framePlane = 'XY'
      const fontSize = await getKclCommandValue(
        '10mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const leaderScale = await getKclCommandValue(
        '1.2',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addCylindricityGdt({
        ast,
        artifactGraph,
        objects,
        tolerance,
        precision,
        framePosition,
        framePlane,
        leaderScale,
        fontSize,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      expect(newCode).toContain('tagEnd = $capEnd001')
      expect(newCode).toContain('faces = [capEnd001]')
      expect(newCode).toContain('tolerance = 0.1mm')
      expect(newCode).toContain('precision = 3')
      expect(newCode).toContain('framePosition = [10, 20]')
      expect(newCode).toContain('framePlane = XY')
      expect(newCode).toContain('fontSize = 10mm')
      expect(newCode).toContain('leaderScale = 1.2')
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addProfileGdt', () => {
    it('should reference faces on a cloned body for a selected edge', async () => {
      const { artifactGraph, ast } = await executeCode(
        clonedRegionBody,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const edge = getSweepEdgesForBody(
        clonedRegionBody,
        'cube2',
        artifactGraph
      ).find((artifact) =>
        artifact.commonSurfaceIds.some(
          (id) => artifactGraph.get(id)?.type === 'cap'
        )
      )
      if (!edge) throw new Error('Expected a cloned sweep edge')

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addProfileGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([edge], artifactGraph),
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode
      expect(newCode).toContain(`gdt::profileLine(
  edges = [
    getCommonEdge(faces = [
      cube2.sketch.tags.line2,
      cube2.faces.capEnd001
    ])
  ],
  tolerance = 0.1mm,
)`)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a profile line annotation to a selected edge', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const edge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      if (!edge) {
        throw new Error('Expected a sweep edge')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const datums = await getKclCommandValue(
        '["A", "B"]',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addProfileGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([edge], artifactGraph),
        datums,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }

      expect(newCode).toContain('gdt::profileLine(')
      expect(newCode).not.toContain('gdt::profile(')
      expect(newCode).toMatch(
        /edges = \[\s*getCommonEdge\(faces = \[[^\]]+\]\)\s*\]/
      )
      expect(newCode).toContain('datums = ["A", "B"]')
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it.each([
      { label: 'cap', sourceCode: box, artifactType: 'cap' },
      { label: 'wall', sourceCode: box, artifactType: 'wall' },
      {
        label: 'edge cut',
        sourceCode: boxWithOneTagAndChamfer,
        artifactType: 'edgeCut',
      },
    ])(
      'should add a profile surface annotation to a selected $label face',
      async ({ sourceCode, artifactType }) => {
        const { artifactGraph, ast } = await executeCode(
          sourceCode,
          instanceInThisFile,
          kclManagerInThisFile
        )
        const face = [...artifactGraph.values()].find(
          (artifact) => artifact.type === artifactType
        )
        if (!face) {
          throw new Error(`Expected a ${artifactType} face`)
        }

        const tolerance = await getKclCommandValue(
          '0.1mm',
          instanceInThisFile,
          rustContextInThisFile
        )
        const result = addProfileGdt({
          ast,
          artifactGraph,
          objects: createSelectionFromArtifacts([face], artifactGraph),
          tolerance,
          wasmInstance: instanceInThisFile,
        })
        if (err(result)) {
          throw result
        }

        const newCode = recast(result.modifiedAst, instanceInThisFile)
        if (err(newCode)) {
          throw newCode
        }

        expect(newCode).toContain('gdt::profileSurface(')
        expect(newCode).not.toContain('gdt::profile(')
        expect(newCode).toContain('faces = [')
        expect(newCode).toContain('tolerance = 0.1mm')

        await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      }
    )

    it('should reject mixed face and edge selections', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const face = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'cap'
      )
      const edge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      if (!face || !edge) {
        throw new Error('Expected a cap face and sweep edge')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addProfileGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([face, edge], artifactGraph),
        tolerance,
        wasmInstance: instanceInThisFile,
      })

      expect(err(result)).toBe(true)
      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toContain(
        'Profile requires either faces or edges, not both'
      )
    })
  })

  describe('Testing addPositionGdt', () => {
    it('should add position annotations to selected faces and edges', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const face = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'cap'
      )
      const edge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      if (!face || !edge) {
        throw new Error('Expected a cap face and sweep edge')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const datums = await getKclCommandValue(
        '["A", "B"]',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addPositionGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([face, edge], artifactGraph),
        datums,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }

      expect(newCode).toContain('gdt::position(')
      expect(newCode).toContain('faces = [')
      expect(newCode).toContain('edges = [')
      expect(newCode).toContain('datums = ["A", "B"]')
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addDistanceGdt', () => {
    it('should add a distance annotation to a selected edge', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const edge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      if (!edge) {
        throw new Error('Expected a sweep edge')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addDistanceGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([edge], artifactGraph),
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }

      expect(newCode).toContain('gdt::distance(')
      expect(newCode).toMatch(
        /edges = \[\s*getCommonEdge\(faces = \[[^\]]+\]\)\s*\]/
      )
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add edge length annotations to multiple selected edges', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const edges = [...artifactGraph.values()]
        .filter((artifact) => artifact.type === 'sweepEdge')
        .slice(0, 3)
      if (edges.length !== 3) {
        throw new Error('Expected three sweep edges')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addDistanceGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts(edges, artifactGraph),
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }

      expect(newCode).toContain('gdt::distance(')
      expect(newCode).toContain('edges = [')
      expect(newCode).not.toContain('from = ')
      expect(newCode).not.toContain('to = ')
      expect(newCode.match(/getCommonEdge/g)?.length).toBeGreaterThanOrEqual(3)
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a distance annotation between two selected edges', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const edges = [...artifactGraph.values()]
        .filter((artifact) => artifact.type === 'sweepEdge')
        .slice(0, 2)
      if (edges.length !== 2) {
        throw new Error('Expected two sweep edges')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addDistanceGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts(edges, artifactGraph),
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }

      expect(newCode).toContain('gdt::distance(')
      expect(newCode).toContain('from = getCommonEdge(')
      expect(newCode).toContain('to = getCommonEdge(')
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a distance annotation between two selected faces', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = [...artifactGraph.values()]
        .filter(
          (artifact) => artifact.type === 'wall' || artifact.type === 'cap'
        )
        .slice(0, 2)
      if (faces.length !== 2) {
        throw new Error('Expected two faces')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addDistanceGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts(faces, artifactGraph),
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }

      expect(newCode).toContain('gdt::distance(')
      expect(newCode).toContain('from = ')
      expect(newCode).toContain('to = ')
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a distance annotation between a selected face and edge', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const face = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'cap' || artifact.type === 'wall'
      )
      const edge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      if (!face || !edge) {
        throw new Error('Expected a face and sweep edge')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addDistanceGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([face, edge], artifactGraph),
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }

      expect(newCode).toContain('gdt::distance(')
      expect(newCode).toContain('from = ')
      expect(newCode).toContain('to = getCommonEdge(')
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addAngularityGdt', () => {
    it('should add angularity annotations to selected faces and edges', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const face = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'cap'
      )
      const edge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      if (!face || !edge) {
        throw new Error('Expected a cap face and sweep edge')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const datums = await getKclCommandValue(
        '["A", "B"]',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addAngularityGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([face, edge], artifactGraph),
        datums,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }

      expect(newCode).toContain('gdt::angularity(')
      expect(newCode).toContain('faces = [')
      expect(newCode).toContain('edges = [')
      expect(newCode).toContain('datums = ["A", "B"]')
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addConcentricityGdt', () => {
    it('should add concentricity annotations to selected faces and edges', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const face = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'cap'
      )
      const edge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      if (!face || !edge) {
        throw new Error('Expected a cap face and sweep edge')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const datums = await getKclCommandValue(
        '["A"]',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addConcentricityGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([face, edge], artifactGraph),
        datums,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }

      expect(newCode).toContain('gdt::concentricity(')
      expect(newCode).toContain('faces = [')
      expect(newCode).toContain('edges = [')
      expect(newCode).toContain('datums = ["A"]')
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addSymmetryGdt', () => {
    it('should add symmetry annotations to selected faces and edges', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const face = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'cap'
      )
      const edge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      if (!face || !edge) {
        throw new Error('Expected a cap face and sweep edge')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const datums = await getKclCommandValue(
        '["A"]',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addSymmetryGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([face, edge], artifactGraph),
        datums,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }

      expect(newCode).toContain('gdt::symmetry(')
      expect(newCode).toContain('faces = [')
      expect(newCode).toContain('edges = [')
      expect(newCode).toContain('datums = ["A"]')
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addRunoutGdt', () => {
    it('should add runout annotations to selected faces and edges', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const face = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'cap'
      )
      const edge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      if (!face || !edge) {
        throw new Error('Expected a cap face and sweep edge')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const datums = await getKclCommandValue(
        '["A"]',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addRunoutGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([face, edge], artifactGraph),
        datums,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }

      expect(newCode).toContain('gdt::runout(')
      expect(newCode).toContain('faces = [')
      expect(newCode).toContain('edges = [')
      expect(newCode).toContain('datums = ["A"]')
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addPerpendicularityGdt', () => {
    it('should add perpendicularity annotations to selected faces and edges', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const face = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'cap'
      )
      const edge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      if (!face || !edge) {
        throw new Error('Expected a cap face and sweep edge')
      }

      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const datums = await getKclCommandValue(
        '["A", "B"]',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addPerpendicularityGdt({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([face, edge], artifactGraph),
        datums,
        tolerance,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }

      expect(newCode).toContain('gdt::perpendicularity(')
      expect(newCode).toContain('faces = [')
      expect(newCode).toContain('edges = [')
      expect(newCode).toContain('datums = ["A", "B"]')
      expect(newCode).toContain('tolerance = 0.1mm')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addParallelismGdt', () => {
    it('should add parallelism annotations to selected faces and edges', async () => {
      const { artifactGraph, ast } = await executeCode(
        boxWithOneTagAndChamfer,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selections = [
        ...[...artifactGraph.values()].filter(
          (artifact) => artifact.type === 'wall'
        ),
        ...[...artifactGraph.values()].filter(
          (artifact) => artifact.type === 'segment'
        ),
      ].slice(0, 2)
      const objects = createSelectionFromArtifacts(selections, artifactGraph)
      const tolerance = await getKclCommandValue(
        '0.1mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const datums = await getKclCommandValue(
        '["A", "B"]',
        instanceInThisFile,
        rustContextInThisFile
      )

      const result = addParallelismGdt({
        ast,
        artifactGraph,
        objects,
        tolerance,
        datums,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }

      expect(newCode).toContain('gdt::parallelism(')
      expect(newCode).toContain('tolerance = 0.1mm')
      expect(newCode).toContain('datums = ["A", "B"]')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addAnnotationGdt', () => {
    it('should add annotations to selected faces and edges', async () => {
      const { artifactGraph, ast } = await executeCode(
        boxWithOneTagAndChamfer,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selections = [
        ...[...artifactGraph.values()].filter(
          (artifact) => artifact.type === 'wall'
        ),
        ...[...artifactGraph.values()].filter(
          (artifact) => artifact.type === 'segment'
        ),
      ].slice(0, 2)
      const objects = createSelectionFromArtifacts(selections, artifactGraph)

      const result = addAnnotationGdt({
        ast,
        artifactGraph,
        objects,
        annotation: 'Break all sharp edges',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }

      expect(newCode).toContain('gdt::annotation(')
      expect(newCode).toContain('annotation = "Break all sharp edges"')
      expect(newCode).toMatch(/faces = \[[^\]]+\]|edges = \[[^\]]+\]/)

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addNoteGdt', () => {
    it('should add a free-floating note on the default (XY) plane', async () => {
      const { ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addNoteGdt({
        ast,
        note: 'Note:',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // A note is standalone: no faces/edges selection, just the text.
      expect(newCode).toContain('gdt::note(note = "Note:")')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a note on a specified plane (framePlane)', async () => {
      const { ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addNoteGdt({
        ast,
        note: 'On XZ',
        framePlane: 'XZ',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      expect(newCode).toContain('gdt::note(')
      expect(newCode).toContain('note = "On XZ"')
      expect(newCode).toContain('framePlane = XZ')

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addDatumGdt', () => {
    it('should add datum annotation to a cap face', async () => {
      const { artifactGraph, ast } = await executeCode(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getCapFromCylinder(artifactGraph)
      const name = 'A'
      const result = addDatumGdt({
        ast,
        artifactGraph,
        faces,
        name,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify the extrude was tagged
      expect(newCode).toContain('tagEnd = $capEnd001')
      // Verify the GDT datum annotation was added
      expect(newCode).toContain('gdt::datum(face = capEnd001, name = "A")')

      // Execute to validate runtime consistency
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add datum annotation to a wall face', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getWallsFromBox(artifactGraph, 1)
      const name = 'C'
      const result = addDatumGdt({
        ast,
        artifactGraph,
        faces,
        name,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify the wall was tagged
      expect(newCode).toContain('tag = $seg01')
      // Verify the GDT datum annotation was added with correct name
      expect(newCode).toContain('gdt::datum(face = seg01, name = "C")')

      // Execute to validate runtime consistency
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add datum annotation to a chamfer face', async () => {
      const { artifactGraph, ast } = await executeCode(
        boxWithOneTagAndChamfer,
        instanceInThisFile,
        kclManagerInThisFile
      )

      // Find the chamfer edgeCut artifact
      const chamferArtifact = [...artifactGraph.values()].find(
        (a) => a.type === 'edgeCut' && a.subType === 'chamfer'
      )
      expect(chamferArtifact).toBeDefined()
      if (!chamferArtifact) {
        throw new Error('Expected chamfer artifact not found')
      }

      // Create selections for GDT
      const faces = createSelectionFromArtifacts(
        [chamferArtifact],
        artifactGraph
      )

      const name = 'D'
      const result = addDatumGdt({
        ast,
        artifactGraph,
        faces,
        name,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify the original segment tag is preserved
      expect(newCode).toContain('xLine(length = 10, tag = $seg01)')
      // Verify the chamfer was tagged properly
      expect(newCode).toContain('tag = $seg02')
      // Verify GDT datum annotation was added for chamfer
      expect(newCode).toContain('gdt::datum(face = seg02, name = "D")')

      // Execute to validate runtime consistency
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should fail when selecting multiple faces', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getWallsFromBox(artifactGraph, 2)
      const name = 'A'
      const result = addDatumGdt({
        ast,
        artifactGraph,
        faces,
        name,
        wasmInstance: instanceInThisFile,
      })

      expect(err(result)).toBeTruthy()
      if (!err(result))
        throw new Error('Should have failed with multiple faces')
      expect(result.message).toContain(
        'Datum annotation requires exactly one face'
      )
    })

    it('should fail when selecting no faces', async () => {
      const { artifactGraph, ast } = await executeCode(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces: Selections = { graphSelections: [], otherSelections: [] }
      const name = 'A'
      const result = addDatumGdt({
        ast,
        artifactGraph,
        faces,
        name,
        wasmInstance: instanceInThisFile,
      })

      expect(err(result)).toBeTruthy()
      if (!err(result)) throw new Error('Should have failed with no faces')
      expect(result.message).toContain('No face selected for datum annotation')
    })

    it('should reject multi-character datum names', async () => {
      const { artifactGraph, ast } = await executeCode(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getCapFromCylinder(artifactGraph)
      const name = 'AB'
      const result = addDatumGdt({
        ast,
        artifactGraph,
        faces,
        name,
        wasmInstance: instanceInThisFile,
      })

      // Should fail with validation error
      expect(err(result)).toBeTruthy()
      if (!err(result))
        throw new Error('Should have failed with multi-character name')
      expect(result.message).toContain('Datum name must be a single character')
    })

    it('should reject empty datum names', async () => {
      const { artifactGraph, ast } = await executeCode(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getCapFromCylinder(artifactGraph)
      const name = ''
      const result = addDatumGdt({
        ast,
        artifactGraph,
        faces,
        name,
        wasmInstance: instanceInThisFile,
      })

      // Should fail with validation error
      expect(err(result)).toBeTruthy()
      if (!err(result)) throw new Error('Should have failed with empty name')
      expect(result.message).toContain('Datum name must be a single character')
    })

    it('should reject datum names with double quotes', async () => {
      const { artifactGraph, ast } = await executeCode(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getCapFromCylinder(artifactGraph)
      const name = '"'
      const result = addDatumGdt({
        ast,
        artifactGraph,
        faces,
        name,
        wasmInstance: instanceInThisFile,
      })

      // Should fail with validation error
      expect(err(result)).toBeTruthy()
      if (!err(result))
        throw new Error('Should have failed with double quote in name')
      expect(result.message).toContain(
        'Datum name cannot contain double quotes'
      )
    })

    it('should add datum annotation with all optional parameters', async () => {
      const { artifactGraph, ast } = await executeCode(
        cylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const faces = getCapFromCylinder(artifactGraph)
      const name = 'A'
      const framePosition = await getKclCommandValue(
        '[5, 0]',
        instanceInThisFile,
        rustContextInThisFile
      )
      const framePlane = 'XZ'
      const leaderScale = await getKclCommandValue(
        '1.1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const fontSize = await getKclCommandValue(
        '12mm',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addDatumGdt({
        ast,
        artifactGraph,
        faces,
        name,
        framePosition,
        framePlane,
        leaderScale,
        fontSize,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const { modifiedAst } = result

      // Should generate KCL with all style parameters
      const newCode = recast(modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      expect(newCode).toContain('gdt::datum(')
      expect(newCode).toContain('face = capEnd001')
      expect(newCode).toContain('name = "A"')
      expect(newCode).toContain('framePosition = [5, 0]')
      expect(newCode).toContain('framePlane = XZ')
      expect(newCode).toContain('leaderScale = 1.1')
      expect(newCode).toContain('fontSize = 12mm')
    })
  })

  describe('Testing getUsedDatumNames', () => {
    it('should return empty array for AST with no datum calls', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10)`
      const ast = assertParse(code, instanceInThisFile)
      const usedNames = getUsedDatumNames(ast)
      expect(usedNames).toEqual([])
    })

    it('should find single datum name', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
gdt::datum(face = capEnd001, name = "A")`
      const ast = assertParse(code, instanceInThisFile)
      const usedNames = getUsedDatumNames(ast)
      expect(usedNames).toEqual(['A'])
    })

    it('should find multiple datum names', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0], tag = $seg01)
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001, tagStart = $capStart001)
gdt::datum(face = capEnd001, name = "A")
gdt::datum(face = seg01, name = "B")
gdt::datum(face = capStart001, name = "C")`
      const ast = assertParse(code, instanceInThisFile)
      const usedNames = getUsedDatumNames(ast)
      expect(usedNames).toEqual(['A', 'B', 'C'])
    })

    it('should handle mixed case datum names', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0], tag = $seg01)
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
gdt::datum(face = capEnd001, name = "a")
gdt::datum(face = seg01, name = "B")`
      const ast = assertParse(code, instanceInThisFile)
      const usedNames = getUsedDatumNames(ast)
      expect(usedNames).toEqual(['a', 'B'])
    })

    it('should ignore non-datum gdt calls', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0], tag = $seg01)
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001, tagStart = $capStart001)
gdt::flatness(faces = [capEnd001, capStart001], tolerance = 0.1)
gdt::datum(face = seg01, name = "A")`
      const ast = assertParse(code, instanceInThisFile)
      const usedNames = getUsedDatumNames(ast)
      expect(usedNames).toEqual(['A'])
    })

    it('should ignore calls without name argument', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0], tag = $seg01)
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
gdt::datum(face = seg01)
gdt::datum(face = capEnd001, name = "A")`
      const ast = assertParse(code, instanceInThisFile)
      const usedNames = getUsedDatumNames(ast)
      expect(usedNames).toEqual(['A'])
    })

    it('should ignore non-string name arguments', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0], tag = $seg01)
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
gdt::datum(face = seg01, name = 123)
gdt::datum(face = capEnd001, name = "A")`
      const ast = assertParse(code, instanceInThisFile)
      const usedNames = getUsedDatumNames(ast)
      expect(usedNames).toEqual(['A'])
    })
  })

  describe('Testing getNextAvailableDatumName', () => {
    it('should return "A" for empty AST', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10)`
      const ast = assertParse(code, instanceInThisFile)
      const nextName = getNextAvailableDatumName(ast)
      expect(nextName).toBe('A')
    })

    it('should return "B" when "A" is used', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
gdt::datum(face = capEnd001, name = "A")`
      const ast = assertParse(code, instanceInThisFile)
      const nextName = getNextAvailableDatumName(ast)
      expect(nextName).toBe('B')
    })

    it('should return "C" when "A" and "B" are used', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0], tag = $seg01)
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
gdt::datum(face = capEnd001, name = "A")
gdt::datum(face = seg01, name = "B")`
      const ast = assertParse(code, instanceInThisFile)
      const nextName = getNextAvailableDatumName(ast)
      expect(nextName).toBe('C')
    })

    it('should handle non-sequential usage', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0], tag = $seg01)
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001, tagStart = $capStart001)
gdt::datum(face = capEnd001, name = "A")
gdt::datum(face = seg01, name = "C")
gdt::datum(face = capStart001, name = "E")`
      const ast = assertParse(code, instanceInThisFile)
      const nextName = getNextAvailableDatumName(ast)
      expect(nextName).toBe('B')
    })

    it('should handle mixed case by treating as uppercase', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0], tag = $seg01)
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
gdt::datum(face = capEnd001, name = "a")
gdt::datum(face = seg01, name = "b")`
      const ast = assertParse(code, instanceInThisFile)
      const nextName = getNextAvailableDatumName(ast)
      expect(nextName).toBe('C')
    })

    it('should return "A" when all letters are used (fallback)', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10)
  |> line(end = [1, 50], tag = $seg01)
  |> line(end = [-1, 50], tag = $seg02)
  |> line(end = [1, 50], tag = $seg03)
  |> line(end = [-1, 50], tag = $seg04)
  |> line(end = [1, 50], tag = $seg05)
  |> line(end = [-1, 50], tag = $seg06)
  |> line(end = [1, 50], tag = $seg07)
  |> line(end = [-1, 50], tag = $seg08)
  |> line(end = [1, 50], tag = $seg09)
  |> line(end = [-1, 50], tag = $seg10)
  |> line(end = [1, 50], tag = $seg11)
  |> line(end = [-1, 50], tag = $seg12)
  |> line(end = [1, 50], tag = $seg13)
  |> line(end = [-1, 50], tag = $seg14)
  |> line(end = [1, 50], tag = $seg15)
  |> line(end = [-1, 50], tag = $seg16)
  |> line(end = [1, 50], tag = $seg17)
  |> line(end = [-1, 50], tag = $seg18)
  |> line(end = [1, 50], tag = $seg19)
  |> line(end = [-1, 50], tag = $seg20)
  |> line(end = [1, 50], tag = $seg21)
  |> line(end = [-1, 50], tag = $seg22)
  |> line(end = [1, 50], tag = $seg23)
  |> line(end = [-1, 50], tag = $seg24)
  |> line(end = [1, 50], tag = $seg25)
  |> line(end = [-1, 50], tag = $seg26)
  |> xLine(length = -10)
  |> close()
extrude001 = extrude(profile001, length = 10)
gdt::datum(face = seg01, name = "A")
gdt::datum(face = seg02, name = "B")
gdt::datum(face = seg03, name = "C")
gdt::datum(face = seg04, name = "D")
gdt::datum(face = seg05, name = "E")
gdt::datum(face = seg06, name = "F")
gdt::datum(face = seg07, name = "G")
gdt::datum(face = seg08, name = "H")
gdt::datum(face = seg09, name = "I")
gdt::datum(face = seg10, name = "J")
gdt::datum(face = seg11, name = "K")
gdt::datum(face = seg12, name = "L")
gdt::datum(face = seg13, name = "M")
gdt::datum(face = seg14, name = "N")
gdt::datum(face = seg15, name = "O")
gdt::datum(face = seg16, name = "P")
gdt::datum(face = seg17, name = "Q")
gdt::datum(face = seg18, name = "R")
gdt::datum(face = seg19, name = "S")
gdt::datum(face = seg20, name = "T")
gdt::datum(face = seg21, name = "U")
gdt::datum(face = seg22, name = "V")
gdt::datum(face = seg23, name = "W")
gdt::datum(face = seg24, name = "X")
gdt::datum(face = seg25, name = "Y")
gdt::datum(face = seg26, name = "Z")`
      const ast = assertParse(code, instanceInThisFile)
      const nextName = getNextAvailableDatumName(ast)
      expect(nextName).toBe('A') // Fallback
    })
  })
})
