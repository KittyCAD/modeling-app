import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { KclManager } from '@src/lang/KclSingleton'
import { assertParse, recast, type ArtifactGraph } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import type { ConnectionManager } from '@src/network/connectionManager'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { addFlatnessGdt } from '@src/lang/modifyAst/gdt'
import type RustContext from '@src/lib/rustContext'
import {
  createSelectionFromArtifacts,
  enginelessExecutor,
  getCapFromCylinder,
} from '@src/lib/testHelpers'
import { afterAll, expect } from 'vitest'

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
  const result = await stringToKclExpression(
    value,
    undefined,
    instance,
    rustContext
  )
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
      const result = addFlatnessGdt({ ast, artifactGraph, faces, tolerance })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify the extrude was tagged
      expect(newCode).toContain('tagEnd = $capEnd001')
      // Verify the GDT annotation was added
      expect(newCode).toContain(
        'gdt::flatness(faces = [capEnd001], tolerance = 0.1mm)'
      )

      await enginelessExecutor(
        result.modifiedAst,
        undefined,
        undefined,
        rustContextInThisFile
      )
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
      const result = addFlatnessGdt({ ast, artifactGraph, faces, tolerance })
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

      await enginelessExecutor(
        result.modifiedAst,
        undefined,
        undefined,
        rustContextInThisFile
      )
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
      const result = addFlatnessGdt({ ast, artifactGraph, faces, tolerance })
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

      await enginelessExecutor(
        result.modifiedAst,
        undefined,
        undefined,
        rustContextInThisFile
      )
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
      await enginelessExecutor(
        result.modifiedAst,
        undefined,
        undefined,
        rustContextInThisFile
      )
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
      })
      if (err(result1)) throw result1

      await enginelessExecutor(
        result1.modifiedAst,
        undefined,
        undefined,
        rustContextInThisFile
      )

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

      await enginelessExecutor(
        result2.modifiedAst,
        undefined,
        undefined,
        rustContextInThisFile
      )
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
      const fontPointSize = await getKclCommandValue(
        '36',
        instanceInThisFile,
        rustContextInThisFile
      )
      const fontScale = await getKclCommandValue(
        '1.5',
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
        fontPointSize,
        fontScale,
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
      expect(newCode).toContain('fontPointSize = 36')
      expect(newCode).toContain('fontScale = 1.5')
      await enginelessExecutor(
        result.modifiedAst,
        undefined,
        undefined,
        rustContextInThisFile
      )
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
      const result = addFlatnessGdt({ ast, artifactGraph, faces, tolerance })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify GDT calls come after all model code
      const lastExtrudeIndex = newCode.lastIndexOf('extrude')
      const firstGdtIndex = newCode.indexOf('gdt::flatness')
      expect(firstGdtIndex).toBeGreaterThan(lastExtrudeIndex)

      await enginelessExecutor(
        result.modifiedAst,
        undefined,
        undefined,
        rustContextInThisFile
      )
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
      const result = addFlatnessGdt({ ast, artifactGraph, faces, tolerance })
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

      await enginelessExecutor(
        result.modifiedAst,
        undefined,
        undefined,
        rustContextInThisFile
      )
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
      const { addFlatnessGdt } = await import('@src/lang/modifyAst/gdt')
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

      await enginelessExecutor(
        result.modifiedAst,
        undefined,
        undefined,
        rustContextInThisFile
      )
    })
  })
})
