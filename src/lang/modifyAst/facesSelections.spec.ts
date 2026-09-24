import { createLiteral, createLocalName } from '@src/lang/create'
import { addShell, getFacesExprsFromSelection } from '@src/lang/modifyAst/faces'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { topLevelRange } from '@src/lang/util'
import {
  type Artifact,
  type ArtifactGraph,
  type CodeRef,
  assertParse,
  recast,
} from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let instance: ModuleType
let engineCommandManager: ConnectionManager

beforeAll(async () => {
  const world = await buildTheWorldAndNoEngineConnection()
  instance = world.instance
  engineCommandManager = world.engineCommandManager
})

afterAll(() => {
  engineCommandManager?.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

// Check generated KCL: cloned faces must use the clone's
// cap or sketch tag, while original faces retain their original tag references.
describe('Shell uses face tags from the selected body', () => {
  it.each([
    ['original', 'cap', 'topCap'],
    ['clone', 'cap', 'clonedBody.faces.topCap'],
    ['original', 'wall', 'profileRegion.tags.circle1'],
    ['clone', 'wall', 'clonedBody.sketch.tags.circle1'],
  ] as const)(
    "uses the correct tag for the %s body's %s face",
    (body, face, expectedFace) => {
      const code = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)
profileSketch = sketch(on = XY) {
  circle1 = circle(start = [5mm, 0mm], center = [0mm, 0mm])
}
profileRegion = region(segments = [profileSketch.circle1])
originalBody = extrude(profileRegion, length = 10mm, tagEnd = $topCap)
clonedBody = clone(originalBody) |> translate(x = 20mm)`
      const ast = assertParse(code, instance)
      const codeRef = (text: string): CodeRef => {
        const start = code.indexOf(text)
        const range = topLevelRange(start, start + text.length)
        return {
          range,
          pathToNode: getNodePathFromSourceRange(ast, range),
          nodePath: { steps: [] },
        }
      }
      const regionRef = codeRef('region(segments = [profileSketch.circle1])')
      const original: Extract<Artifact, { type: 'sweep' }> = {
        type: 'sweep',
        id: 'original',
        pathId: 'original-path',
        subType: 'extrusion',
        codeRef: codeRef(
          'extrude(profileRegion, length = 10mm, tagEnd = $topCap)'
        ),
        surfaceIds: ['original-cap', 'original-wall'],
        edgeIds: [],
        trajectoryId: null,
        method: 'new',
        consumed: false,
      }
      const clone: Extract<Artifact, { type: 'sweep' }> = {
        ...original,
        id: 'clone',
        pathId: 'clone-path',
        sourceSweepId: original.id,
        surfaceIds: ['clone-cap', 'clone-wall'],
        codeRef: codeRef('clone(originalBody)'),
      }
      const sketchSegment: Extract<Artifact, { type: 'segment' }> = {
        type: 'segment',
        id: 'sketch-circle',
        pathId: 'sketch-path',
        edgeIds: [],
        commonSurfaceIds: [],
        codeRef: codeRef('circle(start = [5mm, 0mm], center = [0mm, 0mm])'),
      }
      const regionSegment: Extract<Artifact, { type: 'segment' }> = {
        ...sketchSegment,
        id: 'region-circle',
        pathId: 'region-path',
        originalSegId: sketchSegment.id,
        codeRef: regionRef,
      }
      const cloneSegment: Extract<Artifact, { type: 'segment' }> = {
        ...regionSegment,
        id: 'clone-circle',
        pathId: 'clone-path',
        sourceSegmentId: regionSegment.id,
        codeRef: clone.codeRef,
      }
      // Supply engine-produced face/clone lineage without requiring an engine session.
      const graph: ArtifactGraph = new Map()
      for (const artifact of [
        original,
        clone,
        sketchSegment,
        regionSegment,
        cloneSegment,
      ]) {
        graph.set(artifact.id, artifact)
      }
      for (const sweep of [original, clone]) {
        const segment = sweep === clone ? cloneSegment : regionSegment
        const pathId = `${sweep.id}-path`
        segment.pathId = pathId
        graph.set(pathId, {
          type: 'path',
          id: pathId,
          subType: 'region',
          planeId: 'plane',
          segIds: [segment.id],
          consumed: true,
          sweepId: sweep.id,
          trajectorySweepId: null,
          codeRef: sweep === clone ? clone.codeRef : regionRef,
        })
        graph.set(`${sweep.id}-cap`, {
          type: 'cap',
          id: `${sweep.id}-cap`,
          subType: 'end',
          sweepId: sweep.id,
          edgeCutEdgeIds: [],
          pathIds: [],
          faceCodeRef: sweep.codeRef,
          cmdId: `${sweep.id}-cap-command`,
        })
        graph.set(`${sweep.id}-wall`, {
          type: 'wall',
          id: `${sweep.id}-wall`,
          sweepId: sweep.id,
          segId: sweep === clone ? cloneSegment.id : regionSegment.id,
          edgeCutEdgeIds: [],
          pathIds: [],
          faceCodeRef: regionRef,
          cmdId: `${sweep.id}-wall-command`,
        })
      }
      const result = addShell({
        ast,
        artifactGraph: graph,
        faces: {
          graphSelections: [
            {
              entityRef: { type: 'face', face_id: `${body}-${face}` },
              codeRef: body === 'clone' ? clone.codeRef : original.codeRef,
            },
          ],
          otherSelections: [],
        },
        thickness: {
          valueAst: createLiteral(1, instance),
          valueText: '1',
          valueCalculated: '1',
        },
        wasmInstance: instance,
      })
      if (err(result)) throw result
      const generated = recast(result.modifiedAst, instance)
      if (err(generated)) throw generated
      const bodyName = body === 'clone' ? 'clonedBody' : 'originalBody'
      expect(generated.replace(/\s+/g, '')).toContain(
        `shell001=shell(${bodyName},faces=${expectedFace},thickness=1)`
      )
    }
  )
})

// Both entry points must identify the selected generated face and leave the
// caller's AST untouched, including when one edge treatment must be split.
describe.each(['chamfer', 'fillet'] as const)(
  '%s face tagging',
  (operation) => {
    it.each([undefined, 0, 1])(
      'tags the face for selector %s',
      (sourceSelectorIndex) => {
        const sizeArg = operation === 'chamfer' ? 'length' : 'radius'
        const firstEdge = '{ sideFaces = [bottomFace, endCap] }'
        const secondEdge = '{ sideFaces = [rightFace, endCap] }'
        const selectorArg =
          sourceSelectorIndex === undefined
            ? 'tags = [edge001]'
            : `edges = [${firstEdge}, ${secondEdge}]`
        const code = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)
cutBody = ${operation}(body001, ${selectorArg}, ${sizeArg} = 1mm)`
        const ast = assertParse(code, instance)
        const originalAst = structuredClone(ast)
        const range = topLevelRange(code.indexOf(`${operation}(`), code.length)
        const codeRef: CodeRef = {
          range,
          pathToNode: getNodePathFromSourceRange(ast, range),
          nodePath: { steps: [] },
        }
        const artifact: Extract<Artifact, { type: 'edgeCut' }> = {
          type: 'edgeCut',
          id: 'cut-face',
          subType: operation,
          sourceSelectorIndex,
          edgeIds: [],
          codeRef,
        }
        const graph: ArtifactGraph = new Map([[artifact.id, artifact]])
        const selectedEdge = sourceSelectorIndex === 0 ? firstEdge : secondEdge
        const remainingEdge = sourceSelectorIndex === 0 ? secondEdge : firstEdge
        const tag = `${operation}Face01`
        const expectedCode =
          sourceSelectorIndex === undefined
            ? `@settings(defaultLengthUnit = mm, kclVersion = 2.0)
cutBody = ${operation}(body001, tags = [edge001], ${sizeArg} = 1mm, tag = $${tag})`
            : `@settings(defaultLengthUnit = mm, kclVersion = 2.0)
cutBody = ${operation}(body001, edges = [${selectedEdge}], ${sizeArg} = 1mm, tag = $${tag})
  |> ${operation}(edges = [${remainingEdge}], ${sizeArg} = 1mm)`

        const sharedResult = modifyAstWithTagsForSelection(
          ast,
          { artifact, codeRef },
          graph,
          instance
        )
        if (err(sharedResult)) throw sharedResult
        const faceResult = getFacesExprsFromSelection(
          ast,
          {
            graphSelections: [
              { entityRef: { type: 'face', face_id: artifact.id }, codeRef },
            ],
            otherSelections: [],
          },
          graph,
          instance
        )
        for (const result of [sharedResult, faceResult]) {
          expect(result.exprs).toEqual([createLocalName(tag)])
          expect(recast(result.modifiedAst, instance)).toBe(
            recast(assertParse(expectedCode, instance), instance)
          )
        }
        expect(ast).toEqual(originalAst)
      }
    )
  }
)
