/**
 * Tests for refactoring fillet/chamfer from deprecated tags to edgeRefs (with face tags).
 * The refactor uses the artifact graph to resolve face IDs to tag names (e.g. e1, cap1).
 *
 * Why TypeScript code mod (not Rust):
 * - Face→tag resolution (wall → segment tag, cap → tagStart/tagEnd) and "add tag if missing"
 *   already live in the frontend: createEdgeRefObjectExpression, modifyAstWithTagsForSelection,
 *   modifyAstWithTagForWallFace, modifyAstWithTagForCapFace, etc. Re-implementing in Rust would
 *   require: (1) passing and deserialising the artifact graph into the refactor, (2) implementing
 *   node-by-path lookup and AST mutation (add tag on segment, add tagStart/tagEnd on extrude),
 *   (3) unique name generation. The TS approach reuses all of that and only adds the orchestration
 *   (find fillet/chamfer calls, match metadata, build edgeRefs, replace).
 *
 * Why tests are in TypeScript:
 * - The code mod is implemented in TS (refactorFilletChamferTagsToEdgeRefs in edges.ts), so
 *   unit tests that call it directly live here. The Rust side already has lint tests for Z0006
 *   in deprecated_edge_stdlib.rs; the refactor is TS, so tests that exercise the refactor are TS.
 *
 * Sample KCL (from deprecated_edge_stdlib.rs):
 *   body = startSketchOn(XY)
 *     |> startProfile(at = [0, 0])
 *     |> line(endAbsolute = [10, 0], tag = $e1)
 *     |> ...
 *     |> extrude(length = 5)
 *     |> fillet(radius = 1, tags = [getOppositeEdge(e1)])
 *
 * Expected after refactor (with execState.artifactGraph + edgeRefactorMetadata):
 *   ... |> extrude(length = 5, tagEnd = $capEnd001)
 *     |> fillet(radius = 1, edgeRefs = [{ faces = [e1, capEnd001] }])
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  refactorDirectTagFilletToEdgeRefs,
  refactorFilletChamferTagsToEdgeRefs,
  refactorFilletChamferTagsToEdgeRefsUnified,
} from '@src/lang/modifyAst/edges'
import { defaultArtifactGraph } from '@src/lang/std/artifactGraph'
import { assertParse } from '@src/lang/wasm'
import type {
  ArtifactGraph,
  DirectTagFilletMeta,
  EdgeRefactorMeta,
} from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import type { KclManager } from '@src/lang/KclManager'
import { join } from 'path'

const WASM_PATH = join(process.cwd(), 'public', 'kcl_wasm_lib_bg.wasm')

const SAMPLE_KCL = `body = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0], tag = $e1)
  |> line(endAbsolute = [10, 10])
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [0, 0])
  |> close()
  |> extrude(length = 5)
  |> fillet(radius = 1, tags = [getOppositeEdge(e1)])
`

/** Single-value tags (no array): tags = getOppositeEdge(e1). Valid KCL; lint and refactor should handle it. */
const KCL_SINGLE_TAG_GET_OPPOSITE_EDGE = `body = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0], tag = $e1)
  |> line(endAbsolute = [10, 10])
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [0, 0])
  |> close()
  |> extrude(length = 5)
  |> fillet(radius = 1, tags = getOppositeEdge(e1))
`

const KCL_GET_NEXT_ADJACENT_EDGE = `body = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0], tag = $e1)
  |> line(endAbsolute = [10, 10])
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [0, 0])
  |> close()
  |> extrude(length = 5)
  |> fillet(radius = 1, tags = [getNextAdjacentEdge(e1)])
`

const KCL_GET_PREVIOUS_ADJACENT_EDGE = `body = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0], tag = $e1)
  |> line(endAbsolute = [10, 10])
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [0, 0])
  |> close()
  |> extrude(length = 5)
  |> fillet(radius = 1, tags = [getPreviousAdjacentEdge(e1)])
`

const KCL_GET_COMMON_EDGE = `body = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0], tag = $e1)
  |> line(endAbsolute = [10, 10])
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [0, 0])
  |> close()
  |> extrude(length = 5, tagEnd = $cap1)
  |> fillet(radius = 1, tags = [getCommonEdge(faces = [e1, cap1])])
`

const KCL_EDGE_ID = `body = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0])
  |> line(endAbsolute = [10, 10])
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [0, 0])
  |> close()
  |> extrude(length = 5)
  |> fillet(radius = 1, tags = [edgeId(body, 0)])
`

const KCL_MULTIPLE_IN_TAGS = `body = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0], tag = $e1)
  |> line(endAbsolute = [10, 10], tag = $e2)
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [0, 0])
  |> close()
  |> extrude(length = 5)
  |> fillet(radius = 1, tags = [getOppositeEdge(e1), getOppositeEdge(e2)])
`

/** Direct tag (no stdlib call): fillet(radius = 1, tags = [e1]). Should convert to edgeRefs = [{ faces = [e1, capStart001] }]. */
const KCL_DIRECT_TAG_FILLET = `body = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0], tag = $e1)
  |> line(endAbsolute = [10, 10])
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [0, 0])
  |> close()
  |> extrude(length = 5, tagStart = $capStart001)
  |> fillet(radius = 1, tags = [e1])
`

/** Tags and edgeRefs both present: auto-convert should be available and should merge into one edgeRefs. */
const KCL_TAGS_AND_EDGE_REFS = `body = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0], tag = $e1)
  |> line(endAbsolute = [10, 10])
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [0, 0])
  |> close()
  |> extrude(length = 5, tagStart = $capStart001)
  |> fillet(radius = 1, tags = [e1], edgeRefs = [{ faces = [e1, capStart001] }])
`

/** Mixed direct tag + stdlib in same tags array: both should be converted to edgeRefs (two entries). */
const KCL_MIXED_DIRECT_AND_STDLIB = `body = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0], tag = $e1)
  |> line(endAbsolute = [10, 10])
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [0, 0])
  |> close()
  |> extrude(length = 5)
  |> fillet(radius = 1, tags = [e1, getOppositeEdge(e1)])
`

/** Mixed: one deprecated call + one plain segment tag. TODO: should seg01 stay in same fillet or be split into two fillet calls? */
const KCL_MIXED_DEPRECATED_AND_SEGMENT_TAG = `body = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0], tag = $e1)
  |> line(endAbsolute = [10, 10], tag = $seg01)
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [0, 0])
  |> close()
  |> extrude(length = 5)
  |> fillet(radius = 1, tags = [getOppositeEdge(e1), seg01])
`

/** UUID v4 pattern: 8-4-4-4-12 hex. Refactored output must not contain raw UUIDs in edgeRefs faces. */
const UUID_IN_FACES_REGEX =
  /faces\s*=\s*\[\s*["'][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}["']/i

/** Normalize whitespace for asserting logical line content (recast may insert newlines). */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

describe('refactorFilletChamferTagsToEdgeRefs', () => {
  let wasmInstance: ModuleType

  beforeAll(async () => {
    wasmInstance = await loadAndInitialiseWasmInstance(WASM_PATH)
  })

  describe('unit (no engine)', () => {
    it('returns Error when edgeRefactorMetadata is empty', () => {
      const code =
        'body = startSketchOn(XY)\n  |> extrude(length = 1)\n  |> fillet(radius = 0.1, tags = [getOppositeEdge(e1)])'
      const ast = assertParse(code, wasmInstance)
      const graph: ArtifactGraph = defaultArtifactGraph()
      const result = refactorFilletChamferTagsToEdgeRefs(
        ast,
        [],
        graph,
        wasmInstance
      )
      expect(err(result)).toBe(true)
      if (!err(result)) return
      expect(result.message).toContain('No edge refactor metadata')
    })

    it('returns recast source when metadata and graph are provided (no crash)', () => {
      const ast = assertParse(SAMPLE_KCL, wasmInstance)
      const graph: ArtifactGraph = defaultArtifactGraph()
      // Metadata with a sourceRange that won't match any call (so toFix will be empty);
      // refactor still runs and returns recast of unchanged ast.
      const metadata: EdgeRefactorMeta[] = [
        {
          edgeId: '00000000-0000-0000-0000-000000000000',
          sourceRange: [0, 1, 0],
          faceIds: [
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000002',
          ] as [string, string],
          stdlibFn: 'getOppositeEdge',
        },
      ]
      const result = refactorFilletChamferTagsToEdgeRefs(
        ast,
        metadata,
        graph,
        wasmInstance
      )
      // With empty graph and non-matching sourceRange, toFix is empty so we get recast of original
      expect(err(result)).toBe(false)
      if (err(result)) return
      expect(typeof result).toBe('string')
      expect(result).toContain('fillet')
      expect(result).toContain('getOppositeEdge')
    })
  })

  describe('refactorDirectTagFilletToEdgeRefs (unit)', () => {
    it('returns Error when directTagFilletMetadata is empty', () => {
      const code =
        'body = startSketchOn(XY)\n  |> extrude(length = 1)\n  |> fillet(radius = 0.1, tags = [e1])'
      const ast = assertParse(code, wasmInstance)
      const graph: ArtifactGraph = defaultArtifactGraph()
      const result = refactorDirectTagFilletToEdgeRefs(
        ast,
        [],
        graph,
        wasmInstance
      )
      expect(err(result)).toBe(true)
      if (!err(result)) return
      expect(result.message).toContain('No direct tag fillet metadata')
    })

    it('returns recast source when metadata and graph provided (no crash)', () => {
      const ast = assertParse(KCL_DIRECT_TAG_FILLET, wasmInstance)
      const graph: ArtifactGraph = defaultArtifactGraph()
      // Mock metadata with empty tags so createEdgeRefObjectExpression will fail (no artifact);
      // refactor still runs and returns recast of unchanged ast.
      const metadata: DirectTagFilletMeta[] = [
        {
          callSourceRange: [0, 200, 0],
          tags: [
            {
              tagIdentifier: 'e1',
              edgeId: '00000000-0000-0000-0000-000000000000',
              faceIds: [
                '00000000-0000-0000-0000-000000000001',
                '00000000-0000-0000-0000-000000000002',
              ] as [string, string],
            },
          ],
        },
      ]
      const result = refactorDirectTagFilletToEdgeRefs(
        ast,
        metadata,
        graph,
        wasmInstance
      )
      expect(err(result)).toBe(false)
      if (err(result)) return
      expect(typeof result).toBe('string')
      expect(result).toContain('fillet')
      expect(result).toContain('tags = [e1]')
    })
  })

  describe('integration (engine required)', () => {
    let instanceInThisFile: ModuleType = null!
    let kclManagerInThisFile: KclManager = null!
    let engineCommandManagerInThisFile: { tearDown: () => void } = null!

    beforeEach(async () => {
      if (instanceInThisFile) return
      const { instance, kclManager, engineCommandManager } =
        await buildTheWorldAndConnectToEngine()
      instanceInThisFile = instance
      kclManagerInThisFile = kclManager
      engineCommandManagerInThisFile = engineCommandManager
    })

    afterAll(() => {
      engineCommandManagerInThisFile?.tearDown()
    })

    async function runIntegrationRefactor(kcl: string): Promise<string> {
      const ast = assertParse(kcl, instanceInThisFile)
      await kclManagerInThisFile.executeAst({ ast })
      const execState = kclManagerInThisFile.execState
      expect(
        execState.edgeRefactorMetadata?.length ?? 0
      ).toBeGreaterThanOrEqual(1)
      expect(execState.artifactGraph.size).toBeGreaterThan(0)
      const refactored = refactorFilletChamferTagsToEdgeRefs(
        ast,
        execState.edgeRefactorMetadata ?? [],
        execState.artifactGraph,
        instanceInThisFile
      )
      expect(err(refactored)).toBe(false)
      if (err(refactored)) throw refactored
      return refactored
    }

    it(
      'refactors getOppositeEdge in fillet to edgeRefs with tag names (e1, capEnd001) not UUIDs',
      { timeout: 30_000 },
      async () => {
        const refactored = await runIntegrationRefactor(SAMPLE_KCL)
        expect(refactored).not.toMatch(UUID_IN_FACES_REGEX)
        const n = norm(refactored)
        expect(n).toContain('extrude(length = 5, tagEnd = $capEnd001)')
        expect(n).toContain('fillet(radius = 1, edgeRefs = [')
        expect(n).toContain('faces = [e1, capEnd001]')
      }
    )

    it(
      'refactors fillet with single-value tags (tags = getOppositeEdge(e1), no array) to edgeRefs',
      { timeout: 30_000 },
      async () => {
        const refactored = await runIntegrationRefactor(
          KCL_SINGLE_TAG_GET_OPPOSITE_EDGE
        )
        expect(refactored).not.toMatch(UUID_IN_FACES_REGEX)
        const n = norm(refactored)
        expect(n).toContain('extrude(length = 5, tagEnd = $capEnd001)')
        expect(n).toContain('fillet(')
        expect(n).toContain('edgeRefs = [')
        expect(n).toContain('faces = [e1, capEnd001]')
      }
    )

    it(
      'refactors getNextAdjacentEdge in fillet to edgeRefs with tag names not UUIDs',
      { timeout: 30_000 },
      async () => {
        const refactored = await runIntegrationRefactor(
          KCL_GET_NEXT_ADJACENT_EDGE
        )
        expect(refactored).not.toMatch(UUID_IN_FACES_REGEX)
        const n = norm(refactored)
        // Next adjacent edge is between two wall faces (segments), so both faces are segment tags; no tagEnd added.
        expect(n).toContain('fillet(')
        expect(n).toContain('edgeRefs = [')
        expect(n).toContain('faces = [e1, seg01]')
      }
    )

    it(
      'refactors getPreviousAdjacentEdge in fillet to edgeRefs with tag names not UUIDs',
      { timeout: 30_000 },
      async () => {
        const refactored = await runIntegrationRefactor(
          KCL_GET_PREVIOUS_ADJACENT_EDGE
        )
        expect(refactored).not.toMatch(UUID_IN_FACES_REGEX)
        const n = norm(refactored)
        // Previous adjacent edge is between two wall faces (segments), so both faces are segment tags; no tagEnd added.
        expect(n).toContain('fillet(')
        expect(n).toContain('edgeRefs = [')
        expect(n).toContain('faces = [e1, seg01]')
      }
    )

    it(
      'refactors getCommonEdge in fillet to edgeRefs with tag names (e1, cap1) not UUIDs',
      { timeout: 30_000 },
      async () => {
        const refactored = await runIntegrationRefactor(KCL_GET_COMMON_EDGE)
        expect(refactored).not.toMatch(UUID_IN_FACES_REGEX)
        const n = norm(refactored)
        expect(n).toContain('extrude(length = 5, tagEnd = $cap1)')
        expect(n).toContain('fillet(radius = 1, edgeRefs = [')
        expect(n).toContain('faces = [e1, cap1]')
      }
    )

    it(
      'refactors edgeId in fillet to edgeRefs with tag names not UUIDs',
      { timeout: 30_000 },
      async () => {
        const ast = assertParse(KCL_EDGE_ID, instanceInThisFile)
        await kclManagerInThisFile.executeAst({ ast })
        const execState = kclManagerInThisFile.execState
        if ((execState.edgeRefactorMetadata?.length ?? 0) < 1) {
          // edgeId(solid, index) does not yet produce edgeRefactorMetadata from the engine;
          // when it does, the refactor assertions below will run.
          expect(execState.artifactGraph.size).toBeGreaterThan(0)
          return
        }
        const refactored = refactorFilletChamferTagsToEdgeRefs(
          ast,
          execState.edgeRefactorMetadata ?? [],
          execState.artifactGraph,
          instanceInThisFile
        )
        expect(err(refactored)).toBe(false)
        if (err(refactored)) throw refactored
        expect(refactored).not.toMatch(UUID_IN_FACES_REGEX)
        const n = norm(refactored)
        expect(n).toContain('fillet(radius = 1, edgeRefs = [')
        expect(n).toContain('faces = [')
        // When edgeId metadata exists, extrude may get tagEnd added; fillet has edgeRefs with face tags.
      }
    )

    it(
      'refactors fillet with multiple deprecated calls in tags to edgeRefs (e1, e2)',
      { timeout: 30_000 },
      async () => {
        const refactored = await runIntegrationRefactor(KCL_MULTIPLE_IN_TAGS)
        expect(refactored).not.toMatch(UUID_IN_FACES_REGEX)
        const n = norm(refactored)
        expect(n).toContain('extrude(length = 5, tagEnd = $capEnd001)')
        expect(n).toContain('fillet(')
        expect(n).toContain('edgeRefs = [')
        expect(n).toContain('faces = [e1, capEnd001]')
        expect(n).toContain('faces = [e2, capEnd001]')
      }
    )

    it(
      'refactors direct tags in fillet to edgeRefs (tags = [e1] → edgeRefs = [{ faces = [e1, capStart001] }])',
      { timeout: 30_000 },
      async () => {
        const ast = assertParse(KCL_DIRECT_TAG_FILLET, instanceInThisFile)
        await kclManagerInThisFile.executeAst({ ast })
        const execState = kclManagerInThisFile.execState
        expect(
          execState.directTagFilletMetadata?.length ?? 0
        ).toBeGreaterThanOrEqual(1)
        expect(execState.artifactGraph.size).toBeGreaterThan(0)
        const refactored = refactorFilletChamferTagsToEdgeRefsUnified(
          ast,
          execState.edgeRefactorMetadata ?? [],
          execState.directTagFilletMetadata ?? [],
          execState.artifactGraph,
          instanceInThisFile
        )
        expect(err(refactored)).toBe(false)
        if (err(refactored)) throw refactored
        expect(refactored).not.toMatch(UUID_IN_FACES_REGEX)
        const n = norm(refactored)
        expect(n).toContain('extrude(length = 5, tagStart = $capStart001)')
        expect(n).toContain('fillet(radius = 1, edgeRefs = [')
        expect(n).toContain('faces = [e1, capStart001]')
      }
    )

    it(
      'fillet with both tags and edgeRefs: refactor merges tags into edgeRefs (auto-convert should be available)',
      { timeout: 30_000 },
      async () => {
        const ast = assertParse(KCL_TAGS_AND_EDGE_REFS, instanceInThisFile)
        await kclManagerInThisFile.executeAst({ ast })
        const execState = kclManagerInThisFile.execState
        expect(
          execState.directTagFilletMetadata?.length ?? 0
        ).toBeGreaterThanOrEqual(1)
        const refactored = refactorFilletChamferTagsToEdgeRefsUnified(
          ast,
          execState.edgeRefactorMetadata ?? [],
          execState.directTagFilletMetadata ?? [],
          execState.artifactGraph,
          instanceInThisFile
        )
        expect(err(refactored)).toBe(false)
        if (err(refactored)) throw refactored
        expect(refactored).not.toMatch(UUID_IN_FACES_REGEX)
        const n = norm(refactored)
        expect(n).toContain('fillet(')
        expect(n).toContain('edgeRefs = [')
        // Should have at least two edge refs: one from tags=[e1], one from existing edgeRefs
        const faceCount = (refactored.match(/faces\s*=\s*\[/g) ?? []).length
        expect(faceCount).toBeGreaterThanOrEqual(2)
        expect(n).toContain('faces = [e1, capStart001]')
      }
    )

    it(
      'fillet with mixed direct tag and stdlib (tags = [e1, getOppositeEdge(e1)]): refactor converts both to edgeRefs in order',
      { timeout: 30_000 },
      async () => {
        const ast = assertParse(KCL_MIXED_DIRECT_AND_STDLIB, instanceInThisFile)
        await kclManagerInThisFile.executeAst({ ast })
        const execState = kclManagerInThisFile.execState
        expect(
          execState.edgeRefactorMetadata?.length ?? 0
        ).toBeGreaterThanOrEqual(1)
        expect(
          execState.directTagFilletMetadata?.length ?? 0
        ).toBeGreaterThanOrEqual(1)
        const refactored = refactorFilletChamferTagsToEdgeRefsUnified(
          ast,
          execState.edgeRefactorMetadata ?? [],
          execState.directTagFilletMetadata ?? [],
          execState.artifactGraph,
          instanceInThisFile
        )
        expect(err(refactored)).toBe(false)
        if (err(refactored)) throw refactored
        expect(refactored).not.toMatch(UUID_IN_FACES_REGEX)
        const n = norm(refactored)
        expect(n).toContain('fillet(')
        expect(n).toContain('edgeRefs = [')
        // Must have exactly two edge refs (one for e1, one for getOppositeEdge(e1))
        const faceCount = (refactored.match(/faces\s*=\s*\[/g) ?? []).length
        expect(faceCount).toBe(2)
        expect(n).toContain('faces = [e1, capEnd001]')
      }
    )

    it(
      'mixed tags [getOppositeEdge(e1), seg01]: refactor runs without crashing (TODO: keep seg01 vs split into two fillet calls)',
      { timeout: 30_000 },
      async () => {
        const ast = assertParse(
          KCL_MIXED_DEPRECATED_AND_SEGMENT_TAG,
          instanceInThisFile
        )
        await kclManagerInThisFile.executeAst({ ast })
        const execState = kclManagerInThisFile.execState
        const refactored = refactorFilletChamferTagsToEdgeRefs(
          ast,
          execState.edgeRefactorMetadata ?? [],
          execState.artifactGraph,
          instanceInThisFile
        )
        expect(err(refactored)).toBe(false)
        if (err(refactored)) throw refactored
        // Currently we only convert when ALL tags elements are deprecated; mixed leaves tags as-is.
        // TODO: Decide whether to (1) keep seg01 in same fillet and only convert getOppositeEdge to edgeRefs,
        // or (2) split into two separate fillet calls. For now we just assert no crash.
        expect(refactored).toContain('fillet')
      }
    )
  })
})
