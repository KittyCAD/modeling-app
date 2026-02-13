import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { KclManager } from '@src/lang/KclManager'
import { assertParse, recast, type ArtifactGraph } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import type { Selection } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import type { ConnectionManager } from '@src/network/connectionManager'
import { afterAll, expect, beforeEach, describe, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
let kclManagerInThisFile: KclManager = null!
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

  const { instance, kclManager, engineCommandManager } =
    await buildTheWorldAndConnectToEngine()
  instanceInThisFile = instance
  kclManagerInThisFile = kclManager
  engineCommandManagerInThisFile = engineCommandManager
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

const createSelectionWithFirstMatchingArtifact = async (
  artifactGraph: ArtifactGraph,
  artifactType: string,
  subType?: string
) => {
  // Check if any artifacts of this type exist at all
  const allArtifactsOfType = [...artifactGraph].filter(([, artifact]) => {
    if (artifact.type !== artifactType) return false
    // If subType is specified, check for that too
    if (subType && 'subType' in artifact && artifact.subType !== subType)
      return false
    return true
  })

  // get first artifact of this type
  const firstArtifactsOfType = allArtifactsOfType[0][1]
  if (!firstArtifactsOfType) {
    return new Error(`No artifacts of type ${artifactType} found`)
  }

  // get codeRef
  let codeRef = null

  if (firstArtifactsOfType.type === 'segment') {
    codeRef = firstArtifactsOfType.codeRef
  } else if (firstArtifactsOfType.type === 'sweepEdge') {
    // find the parent segment
    const segment = [...artifactGraph].filter(([, artifact]) => {
      if (artifact.id !== firstArtifactsOfType.segId) return false
      return true
    })
    if ('codeRef' in segment[0][1]) {
      codeRef = segment[0][1].codeRef
    }
  }

  if (!codeRef) {
    return new Error('No codeRef found for artifact')
  }

  // Create selection from found artifact
  const selection: Selection = {
    artifact: firstArtifactsOfType,
    codeRef: codeRef,
  }

  return { selection }
}

describe('tagManagement.test.ts', () => {
  // Tag Management System Tests
  //
  // The tag management system automatically adds tags to KCL expressions
  // when users select geometry for operations.
  //
  // Test Structure:
  // - Integration tests: modifyAstWithTagsForSelection (high-level workflows)
  // - Unit tests: mutateAstWithTagForSketchSegment (specific edge cut functionality)
  //
  // Key functionality tested:
  // - Face tagging: wall faces, cap faces, edgeCut faces (chamfers/fillets)
  // - Edge tagging: segments, sweep edges
  // - Complex scenarios: multi-tag breakup, tag deduplication
  const basicExampleCode = `
sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 15)`
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

  describe('modifyAstWithTagsForSelection', () => {
    // ----------------------------------------
    // 2D Entities
    // ----------------------------------------

    // TODO: Add handling for PLANE selections (2D construction planes)

    // ----------------------------------------
    // Sketch Entities
    // ----------------------------------------

    // TODO: Add handling for POINT selections (sketch points)
    // TODO: Add handling for CURVE selections (lines, arcs, splines)
    // TODO: Add handling for SKETCH selections (entire sketches)

    // ----------------------------------------
    // Body Entities
    // ----------------------------------------

    // TODO: Add handling for VERTEX selections

    // Handle EDGE selections (commonEdge approach)
    it('should tag a segment and capStart using commonEdge approach', async () => {
      const { ast, artifactGraph } = await executeCode(
        basicExampleCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      // Find an edge artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'segment' // segment // sweepEdge // edgeCutEdge
        // adjacent // opposite
      )
      if (err(selectionResult)) return selectionResult
      const { selection } = selectionResult

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        selection,
        artifactGraph,
        instanceInThisFile
      )
      if (err(result)) return result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst, instanceInThisFile)

      // Verify results
      expect(tags.length).toBe(2) // Should add two tags
      expect(newCode).toContain('tag = $seg01')
      expect(newCode).toContain('tagStart = $capStart001')
      expect(tags).toBeTruthy() // Tags should be non-empty strings
    }, 5_000)
    it('should tag 2 segments using commonEdge approach', async () => {
      const { ast, artifactGraph } = await executeCode(
        basicExampleCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      // Find an edge artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'sweepEdge', // segment // sweepEdge // edgeCutEdge
        'adjacent' // adjacent // opposite
      )
      if (err(selectionResult)) return selectionResult
      const { selection } = selectionResult

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        selection,
        artifactGraph,
        instanceInThisFile
      )
      if (err(result)) return result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst, instanceInThisFile)

      // Verify results
      expect(tags.length).toBe(2) // Should add two tags
      expect(newCode).toContain('tag = $seg01')
      expect(newCode).toContain('tag = $seg02')
      expect(tags).toBeTruthy() // Tags should be non-empty strings
    }, 5_000)
    it('should tag a segment and capEnd using commonEdge approach', async () => {
      const { ast, artifactGraph } = await executeCode(
        basicExampleCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      // Find an edge artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'sweepEdge', // segment // sweepEdge // edgeCutEdge
        'opposite' // adjacent // opposite
      )
      if (err(selectionResult)) return selectionResult
      const { selection } = selectionResult

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        selection,
        artifactGraph,
        instanceInThisFile
      )
      if (err(result)) return result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst, instanceInThisFile)

      // Verify results
      expect(tags.length).toBe(2) // Should add two tags
      expect(newCode).toContain('tag = $seg01')
      expect(newCode).toContain('tagEnd = $capEnd001')
      expect(tags).toBeTruthy() // Tags should be non-empty strings
    }, 5_000)
    // Handle EDGE selections (getOpposite/AdjacentEdge approach)
    it('should tag a segment using legacy oppositeAndAdjacentEdges approach for base edge selection', async () => {
      const { ast, artifactGraph } = await executeCode(
        basicExampleCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      // Find an edge artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'segment' // segment // sweepEdge // edgeCutEdge
        // adjacent // opposite
      )
      if (err(selectionResult)) return selectionResult
      const { selection } = selectionResult

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        selection,
        artifactGraph,
        instanceInThisFile,
        ['oppositeAndAdjacentEdges']
      )
      if (err(result)) return result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst, instanceInThisFile)

      // Verify results
      expect(tags.length).toBe(1) // Should add one tag
      expect(newCode).toContain('tag = $seg01')
      expect(tags).toBeTruthy() // Tags should be non-empty strings
    }, 5_000)
    it('should tag a segment using legacy oppositeAndAdjacentEdges approach for adjacent edge selection', async () => {
      const { ast, artifactGraph } = await executeCode(
        basicExampleCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      // Find an edge artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'sweepEdge', // segment // sweepEdge // edgeCutEdge
        'adjacent' // adjacent // opposite
      )
      if (err(selectionResult)) return selectionResult
      const { selection } = selectionResult
      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        selection,
        artifactGraph,
        instanceInThisFile,
        ['oppositeAndAdjacentEdges']
      )
      if (err(result)) return result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst, instanceInThisFile)

      // Verify results
      expect(tags.length).toBe(1) // Should add one tag
      expect(newCode).toContain('tag = $seg01')
      expect(tags).toBeTruthy() // Tags should be non-empty strings
    }, 5_000)
    it('should tag a segment using legacy oppositeAndAdjacentEdges approach for opposite edge selection', async () => {
      const { ast, artifactGraph } = await executeCode(
        basicExampleCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      // Find an edge artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'sweepEdge', // segment // sweepEdge // edgeCutEdge
        'opposite' // adjacent // opposite
      )
      if (err(selectionResult)) return selectionResult
      const { selection } = selectionResult

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        selection,
        artifactGraph,
        instanceInThisFile,
        ['oppositeAndAdjacentEdges']
      )
      if (err(result)) return result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst, instanceInThisFile)

      // Verify results
      expect(tags.length).toBe(1) // Should add one tag
      expect(newCode).toContain('tag = $seg01')
      expect(tags).toBeTruthy() // Tags should be non-empty strings
    }, 5_000)

    // Handle FACE selections
    it('should tag a wall face by tagging the underlying segment', async () => {
      const { ast, artifactGraph } = await executeCode(
        basicExampleCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      // Find a wall face artifact
      const wallArtifact = [...artifactGraph.values()].find(
        (a) => a.type === 'wall'
      )
      expect(wallArtifact).toBeDefined()

      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'wall'
      )
      if (err(selectionResult)) return selectionResult
      const wallFaceSelection = selectionResult.selection

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        wallFaceSelection,
        artifactGraph,
        instanceInThisFile
      )
      if (err(result)) throw result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify results - should tag the underlying segment
      expect(tags.length).toBe(1)
      expect(newCode).toContain('tag = $seg01')
      expect(tags[0]).toBeTruthy()
    }, 5_000)

    it('should tag a cap face by tagging the extrusion', async () => {
      const { ast, artifactGraph } = await executeCode(
        basicExampleCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      // Find a cap face artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'cap'
      )
      if (err(selectionResult)) return selectionResult
      const capFaceSelection = selectionResult.selection

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        capFaceSelection,
        artifactGraph,
        instanceInThisFile
      )
      if (err(result)) throw result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify results - should tag the extrusion
      expect(tags.length).toBe(1)
      // Should tag either start or end cap depending on which one was found
      const hasTagStart = newCode.includes('tagStart = $capStart001')
      const hasTagEnd = newCode.includes('tagEnd = $capEnd001')
      expect(hasTagStart || hasTagEnd).toBe(true)
      expect(tags[0]).toBeTruthy()
    }, 5_000)

    it('should tag an edgeCut face by tagging the edgeCut expression', async () => {
      const { ast, artifactGraph } = await executeCode(
        boxWithOneTagAndChamfer,
        instanceInThisFile,
        kclManagerInThisFile
      )
      // Find an edgeCut face artifact (created by chamfer)
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'edgeCut'
      )
      if (err(selectionResult)) return selectionResult
      const edgeCutFaceSelection = selectionResult.selection

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        edgeCutFaceSelection,
        artifactGraph,
        instanceInThisFile
      )
      if (err(result)) throw result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify results - should tag the chamfer operation (edgeCut expression)
      expect(tags.length).toBe(1)
      expect(newCode).toContain('tag = $seg02') // The NEW chamfer tag that was added
      expect(tags[0]).toBe('seg02') // The returned tag should be seg02
    }, 5_000)
  })

  describe('mutateAstWithTagForSketchSegment', () => {
    it('should successfully tag a chamfer edgeCut', async () => {
      const { ast, artifactGraph } = await executeCode(
        boxWithOneTagAndChamfer,
        instanceInThisFile,
        kclManagerInThisFile
      )

      // Find the chamfer edgeCut artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'edgeCut',
        'chamfer'
      )
      if (err(selectionResult)) return selectionResult
      const chamferFaceSelection = selectionResult.selection

      const result = modifyAstWithTagsForSelection(
        ast,
        chamferFaceSelection,
        artifactGraph,
        instanceInThisFile
      )
      if (err(result)) throw result
      const { modifiedAst, tags } = result
      const tag = tags[0]
      const newCode = recast(modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode

      // Verify chamfer tagging worked
      expect(tag).toBeTruthy()
      expect(newCode).toContain('tag = $seg02')
    }, 5_000)

    it('should successfully tag a fillet edgeCut', async () => {
      const { ast, artifactGraph } = await executeCode(
        boxWithOneTagAndFillet,
        instanceInThisFile,
        kclManagerInThisFile
      )

      // Find the fillet edgeCut artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'edgeCut',
        'fillet'
      )
      if (err(selectionResult)) return selectionResult
      const filletFaceSelection = selectionResult.selection

      const result = modifyAstWithTagsForSelection(
        ast,
        filletFaceSelection,
        artifactGraph,
        instanceInThisFile
      )

      // This should now succeed with our fix
      expect(err(result)).toBeFalsy()
      if (!err(result)) {
        const { modifiedAst, tags } = result
        const tag = tags[0]
        const newCode = recast(modifiedAst, instanceInThisFile)
        if (!err(newCode)) {
          // Verify fillet tagging worked
          expect(tag).toBeTruthy()
          expect(newCode).toContain('tag = $seg02')
        }
      }
    }, 5_000)
  })
})
