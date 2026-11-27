import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { expect, test, vi } from 'vitest'
import opfs from '@src/lib/fs-zds/opfs'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { getAstAndArtifactGraph } from '@src/lib/testHelpers'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'

import { v4 as uuid } from 'uuid'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { getEventForQueryEntityTypeWithPoint } from '@src/lib/selections'
import {
  addFillet,
  createSubtractionLineageEdgeRef,
} from '@src/lang/modifyAst/edges'
import { traceSubtractionFaceOrigin } from '@src/lang/std/subtractionLineage'
import { assertParse, recast } from '@src/lang/wasm'
import { mockExecAstAndReportErrors } from '@src/lang/modelingWorkflows'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { Artifact } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'

const fixtureDirectory = process.env.SELECT_ANYTHING_FIXTURE_DIR

test.skipIf(!fixtureDirectory)(
  'runs subtraction fixtures through the app executor and live engine',
  async () => {
    const world = await buildTheWorldAndConnectToEngine({
      webrtc: false,
      geometryOnly: true,
    })
    const send = world.engineCommandManager.sendSceneCommand.bind(
      world.engineCommandManager
    )
    const children = async (id: string) => {
      const response = await send({
        type: 'modeling_cmd_req',
        cmd_id: uuid(),
        cmd: { type: 'entity_get_all_child_uuids', entity_id: id },
      })
      if (!isModelingResponse(response))
        throw new Error('missing body children')
      const body = response.resp.data.modeling_response
      if (body.type !== 'entity_get_all_child_uuids')
        throw new Error('unexpected response')
      return body.data.entity_ids
    }
    const twoCutTopWallEdges = async (
      output: Extract<Artifact, { type: 'compositeSolid' }>,
      graph: ArtifactGraph
    ) => {
      const result = []
      const origin = (faceId: string) =>
        traceSubtractionFaceOrigin(output, faceId, graph)
      for (const id of await children(output.id)) {
        const response = await send({
          type: 'modeling_cmd_req',
          cmd_id: uuid(),
          cmd: { type: 'query_entity_type', entity_id: id },
        })
        if (!isModelingResponse(response)) continue
        const payload = response.resp.data.modeling_response
        if (payload.type !== 'query_entity_type') continue
        const ref = payload.data.reference
        if (ref.type !== 'edge') continue
        const baseSides = ref.side_faces
          .map(origin)
          .filter((side) => side?.cutDepth === 1 && side.operand === 'target')
        if (
          !baseSides.some((side) => side?.role.type === 'end') ||
          !baseSides.some(
            (side) => side?.role.type === 'wall' && side.role.segmentIndex === 0
          )
        )
          continue
        const endsAtSecondNotch = (ref.end_faces ?? [])
          .map(origin)
          .some(
            (end) =>
              end?.cutDepth === 0 &&
              end.operand === 'tool' &&
              end.role.type === 'wall' &&
              end.role.segmentIndex === 3
          )
        result.push({ id, endsAtSecondNotch, reference: ref })
      }
      return result
    }
    try {
      for (const [fixture, count] of [
        ['ordinary-cut', 1],
        ['edge-split', 1],
        ['face-split', 1],
        ['body-split', 2],
        ['lineage-two-cut-part', 1],
        ['lineage-copy-part', 0],
      ] as const) {
        const code = readFileSync(
          resolve(fixtureDirectory!, fixture + '.kcl'),
          'utf8'
        )
        const { ast, artifactGraph } = await getAstAndArtifactGraph(
          code,
          world.instance,
          world.kclManager
        )
        expect(
          world.kclManager.diagnostics.filter(
            (diagnostic) => diagnostic.severity === 'error'
          ),
          fixture
        ).toEqual([])
        const outputs = [...artifactGraph.values()].filter(
          (
            artifact
          ): artifact is Extract<Artifact, { type: 'compositeSolid' }> =>
            artifact.type === 'compositeSolid' &&
            artifact.subType === 'subtract' &&
            !artifact.consumed
        )
        expect(outputs, fixture).toHaveLength(count)
        if (fixture === 'face-split' || fixture === 'body-split') {
          expect(
            outputs.some((output) =>
              Object.entries(output.subtractionFaceSources ?? {}).some(
                ([id, source]) => id !== source
              )
            ),
            fixture
          ).toBe(true)
        }
        if (fixture === 'face-split') {
          const output = outputs[0]
          const sources = output.subtractionFaceSources ?? {}
          const topEdges = new Map<
            string,
            { id: string; endFaces: string[] }[]
          >()
          for (const id of await children(output.id)) {
            const reply = await send({
              type: 'modeling_cmd_req',
              cmd_id: uuid(),
              cmd: { type: 'query_entity_type', entity_id: id },
            })
            if (!isModelingResponse(reply)) continue
            const payload = reply.resp.data.modeling_response
            if (payload.type !== 'query_entity_type') continue
            const ref = payload.data.reference
            if (ref.type !== 'edge') continue
            const sourceFaces = ref.side_faces.map(
              (face) => sources[face] ?? face
            )
            if (
              !sourceFaces.some((face) => {
                const artifact = artifactGraph.get(face)
                return artifact?.type === 'cap' && artifact.subType === 'end'
              })
            )
              continue
            const key = sourceFaces.sort().join(',')
            const edges = topEdges.get(key) ?? []
            edges.push({ id, endFaces: ref.end_faces ?? [] })
            topEdges.set(key, edges)
          }
          const splitTopEdges = [...topEdges.values()].find(
            (edges) => edges.length === 2
          )
          expect(
            splitTopEdges,
            'the top edge should have two live descendants'
          ).toBeDefined()
          if (!splitTopEdges) throw new Error('Missing the split top edges')
          expect(splitTopEdges.map(({ endFaces }) => endFaces.length)).toEqual([
            1, 1,
          ])
          expect(splitTopEdges[0].endFaces).not.toEqual(
            splitTopEdges[1].endFaces
          )

          for (const end of ['side3', 'side1']) {
            const edited = code.replace(
              'length = 10mm)',
              'length = 10mm, tagEnd = $topCap)'
            )
            await getAstAndArtifactGraph(
              edited +
                `\nrounded = fillet(result[0], edges = [{ sideFaces = [baseRegion.tags.side0, result[0].faces.topCap], endFaces = [toolRegion.tags.${end}] }], radius = 1mm, tangentChain = false)\n`,
              world.instance,
              world.kclManager
            )
            expect(
              world.kclManager.diagnostics.filter(
                (d) => d.severity === 'error'
              ),
              end
            ).toEqual([])
          }
        }
        if (fixture === 'lineage-two-cut-part') {
          const tagged = code.replace(
            'length = 10mm)',
            'length = 10mm, tagEnd = $originalTop)'
          )
          await world.rustContext.clearSceneAndBustCache({})
          const taggedScene = await getAstAndArtifactGraph(
            tagged,
            world.instance,
            world.kclManager
          )
          const taggedOutput = [...taggedScene.artifactGraph.values()].find(
            (artifact) =>
              artifact.type === 'compositeSolid' &&
              artifact.subType === 'subtract' &&
              !artifact.consumed
          )
          let expectedEdgeId: string | undefined
          if (
            taggedOutput?.type === 'compositeSolid' &&
            taggedOutput.subtractionFaceIdentityLineage
          ) {
            const edges = await twoCutTopWallEdges(
              taggedOutput,
              taggedScene.artifactGraph
            )
            const narrowed = edges.filter(
              ({ endsAtSecondNotch }) => endsAtSecondNotch
            )
            expect(narrowed).toHaveLength(1)
            expectedEdgeId = narrowed[0].id
          }
          const auditLog = process.env.SELECT_ANYTHING_ENGINE_AUDIT_LOG
          const auditStart = auditLog
            ? readFileSync(auditLog, 'utf8').length
            : 0
          const { variables } = await getAstAndArtifactGraph(
            tagged +
              '\nrounded = fillet(finished[0], edges = [{ sideFaces = [baseRegion.tags.side0, finished[0].faces.originalTop], endFaces = [wideRegion.tags.side3] }], radius = 0.2mm, tangentChain = false)\n',
            world.instance,
            world.kclManager
          )
          expect(
            world.kclManager.diagnostics.filter(
              (diagnostic) => diagnostic.severity === 'error'
            )
          ).toEqual([])
          if (auditLog) {
            const targets = readFileSync(auditLog, 'utf8')
              .slice(auditStart)
              .split('\n')
              .filter((line) => line.startsWith('SELECT_ANYTHING_CUT_TARGETS '))
              .map((line) =>
                JSON.parse(line.slice('SELECT_ANYTHING_CUT_TARGETS '.length))
              )
            const rounded = variables.rounded
            if (rounded?.type !== 'Solid') {
              throw new Error('Missing the rounded two-cut body')
            }
            expect(targets).toHaveLength(1)
            expect(targets[0].body).toBe(rounded.value.id)
            if (expectedEdgeId) {
              expect(targets[0].edges).toEqual([expectedEdgeId])
            } else {
              expect(targets[0].edges).toHaveLength(1)
            }
          }
        }
        if (fixture === 'body-split') {
          const withBothOutputs =
            code + '\nfirstOutput = result[0]\nsecondOutput = result[1]\n'
          const reviewAst = assertParse(withBothOutputs, world.instance)
          expect(
            await mockExecAstAndReportErrors(reviewAst, world.rustContext)
          ).toBeUndefined()

          // Both array positions must remain valid standalone KCL references.
          await getAstAndArtifactGraph(
            withBothOutputs,
            world.instance,
            world.kclManager
          )
          expect(
            world.kclManager.diagnostics.filter((d) => d.severity === 'error')
          ).toEqual([])
          await getAstAndArtifactGraph(code, world.instance, world.kclManager)

          const radius = (await stringToKclExpression(
            '0.2mm',
            world.rustContext
          )) as KclCommandValue
          const rejectionDetails: string[] = []
          let picked: { id: string; ownerId: string; code: string } | undefined
          for (const output of outputs) {
            for (const id of await children(output.id)) {
              const response = await send({
                type: 'modeling_cmd_req',
                cmd_id: uuid(),
                cmd: { type: 'query_entity_type', entity_id: id },
              })
              if (!isModelingResponse(response)) continue
              const reply = response.resp.data.modeling_response
              if (reply.type !== 'query_entity_type') continue
              const reference = reply.data.reference
              if (
                reference.type !== 'edge' ||
                !reference.side_faces.some(
                  (faceId) =>
                    output.subtractionFaceSources?.[faceId] &&
                    output.subtractionFaceSources[faceId] !== faceId
                )
              )
                continue
              const event = await getEventForQueryEntityTypeWithPoint(
                { entity_id: id, reference },
                { ...world, wasmInstance: world.instance }
              )
              if (
                event?.type !== 'Set selection' ||
                event.data.selectionType !== 'singleCodeCursor'
              )
                continue
              const edit = addFillet({
                ast: structuredClone(ast),
                artifactGraph,
                selection: {
                  graphSelections: [event.data.selection],
                  otherSelections: [],
                },
                radius,
                tangentChain: false,
                wasmInstance: world.instance,
              })
              if (edit instanceof Error) {
                rejectionDetails.push(edit.message)
                continue
              }
              const editedCode = recast(edit.modifiedAst, world.instance)
              if (
                editedCode instanceof Error ||
                !editedCode.includes('sideFaces')
              )
                continue
              picked = { id, ownerId: output.id, code: editedCode }
              break
            }
            if (picked) break
          }
          expect(
            picked,
            `a live edge with split provenance must produce a semantic fillet: ${rejectionDetails.join(', ')}`
          ).toBeDefined()
          if (!picked) return
          const other = outputs.find((output) => output.id !== picked.ownerId)!
          const otherBefore = await children(other.id)
          await getAstAndArtifactGraph(
            picked.code,
            world.instance,
            world.kclManager
          )
          expect(
            world.kclManager.diagnostics.filter((d) => d.severity === 'error')
          ).toEqual([])
          expect(await children(picked.ownerId)).not.toContain(picked.id)
          expect(new Set(await children(other.id))).toEqual(
            new Set(otherBefore)
          )
          const incrementalCounts = await Promise.all(
            outputs.map(async (output) => (await children(output.id)).length)
          )
          await world.rustContext.clearSceneAndBustCache({})
          const fresh = await getAstAndArtifactGraph(
            picked.code,
            world.instance,
            world.kclManager
          )
          expect(
            world.kclManager.diagnostics.filter((d) => d.severity === 'error')
          ).toEqual([])
          const freshCounts = await Promise.all(
            outputs.map(async (output) => {
              const sameOutput = [...fresh.artifactGraph.values()].find(
                (artifact) =>
                  artifact.type === 'compositeSolid' &&
                  artifact.subType === 'subtract' &&
                  artifact.outputIndex === output.outputIndex
              )
              if (!sameOutput)
                throw new Error(
                  'subtraction output missing after fresh execution'
                )
              return (await children(sameOutput.id)).length
            })
          )
          expect(freshCounts).toEqual(incrementalCounts)

          const taggedBase = code.replace(
            'length = 10mm)',
            'length = 10mm, tagEnd = $originalTop)'
          )
          const scopedFaces = await getAstAndArtifactGraph(
            taggedBase +
              '\nfirstTop = faceOf(result[0], face = END)\nsecondTop = faceOf(result[1], face = result[1].faces.originalTop)\n',
            world.instance,
            world.kclManager
          )
          expect(
            world.kclManager.diagnostics.filter((d) => d.severity === 'error')
          ).toEqual([])
          for (const [index, name] of ['firstTop', 'secondTop'].entries()) {
            const owner = [...scopedFaces.artifactGraph.values()].find(
              (artifact) =>
                artifact.type === 'compositeSolid' &&
                artifact.outputIndex === index
            )
            const resolved = scopedFaces.variables[name]
            if (!owner || resolved?.type !== 'Face') {
              throw new Error(`Missing resolved face or output for ${name}`)
            }
            expect(await children(owner.id)).toContain(resolved.value.id)
            expect(resolved.value.parentSolid.solidId).toBe(owner.id)
          }
          const sketchProgram = await world.rustContext.hackSetProgram(
            assertParse(taggedBase, world.instance),
            jsAppSettings(world.rustContext.settingsActor)
          )
          if (sketchProgram.type !== 'Success')
            throw new Error('Failed to synchronize the sketch program')
          const capOutputIndices = sketchProgram.sceneGraph.objects.flatMap(
            (object) =>
              object.kind.type === 'Cap' &&
              object.kind.kind === 'end' &&
              object.kind.solidOutputIndex !== undefined
                ? [object.kind.solidOutputIndex]
                : []
          )
          expect(capOutputIndices.sort()).toEqual([0, 1])
        }
      }
      for (const [fixture, exportedName, length] of [
        ['lineage-two-cut', 'finished', 1],
        ['lineage-copy', 'instances', 3],
      ] as const) {
        const mainPath = resolve(fixtureDirectory!, fixture + '-main.kcl')
        const partPath = resolve(fixtureDirectory!, fixture + '-part.kcl')
        const mainCode = readFileSync(mainPath, 'utf8')
        const partCode = readFileSync(partPath, 'utf8')
        const readFile = vi
          .spyOn(opfs.impl, 'readFile')
          .mockImplementation(async (path) =>
            readFileSync(resolve(fixtureDirectory!, basename(path)))
          )
        try {
          await world.rustContext.sendOpenProject(mainPath, [
            { id: 0, path: mainPath, text: mainCode },
            { id: 1, path: partPath, text: partCode },
          ])
          await world.rustContext.clearSceneAndBustCache({}, mainPath)
          const outcome = await world.rustContext.execute(
            assertParse(mainCode, world.instance),
            {},
            mainPath
          )
          const exported = outcome.variables[exportedName]
          expect(exported?.type, fixture).toBe('HomArray')
          if (exported?.type !== 'HomArray') {
            throw new Error(`Missing exported body collection in ${fixture}`)
          }
          expect(exported.value).toHaveLength(length)
          const liveChildren = new Map<string, string[]>()
          for (const body of exported.value) {
            if (body.type !== 'Solid') {
              throw new Error(`Expected a solid in ${fixture}`)
            }
            const owned = await children(body.value.id)
            expect(owned).not.toHaveLength(0)
            liveChildren.set(body.value.id, owned)
          }
          expect(liveChildren.size).toBe(length)
          const owners = [...liveChildren.keys()]
          if (fixture === 'lineage-two-cut') {
            const output = outcome.artifactGraph.get(owners[0])
            if (output?.type !== 'compositeSolid') {
              throw new Error('Missing the imported second subtraction output')
            }
            const firstOutput = outcome.artifactGraph.get(output.solidIds[0])
            expect(firstOutput).toMatchObject({
              type: 'compositeSolid',
              subType: 'subtract',
              consumed: true,
            })
            const secondLineage = output.subtractionFaceIdentityLineage
            if (process.env.SELECT_ANYTHING_REQUIRE_FACE_LINEAGE) {
              expect(secondLineage).toBeDefined()
            }
            if (secondLineage && firstOutput?.type === 'compositeSolid') {
              const firstLineage = firstOutput.subtractionFaceIdentityLineage
              if (!firstLineage)
                throw new Error('Missing the first cut lineage')
              expect(firstLineage.sourceRange[2]).toBeGreaterThan(0)
              expect(secondLineage.sourceRange[2]).toBe(
                firstLineage.sourceRange[2]
              )
              expect(secondLineage.operationId).not.toBe(
                firstLineage.operationId
              )
              const origins = Object.keys(secondLineage.sources).map((faceId) =>
                traceSubtractionFaceOrigin(
                  output,
                  faceId,
                  outcome.artifactGraph
                )
              )
              expect(origins).toContainEqual({
                cutDepth: 1,
                operand: 'target',
                role: { type: 'end' },
              })
              for (const cutDepth of [0, 1]) {
                expect(origins).toContainEqual(
                  expect.objectContaining({
                    cutDepth,
                    operand: 'tool',
                    role: expect.objectContaining({ type: 'wall' }),
                  })
                )
              }
              const secondChildren = liveChildren.get(output.id)
              const edges = await twoCutTopWallEdges(
                output,
                outcome.artifactGraph
              )
              expect(edges).toHaveLength(3)
              const narrowed = edges.filter(
                ({ endsAtSecondNotch }) => endsAtSecondNotch
              )
              expect(narrowed).toHaveLength(1)
              const { reference } = narrowed[0]
              const edge = createSubtractionLineageEdgeRef(
                reference,
                output,
                outcome.artifactGraph,
                world.instance
              )
              if (edge instanceof Error) throw edge
              expect(
                createSubtractionLineageEdgeRef(
                  { ...reference, end_faces: [] },
                  output,
                  outcome.artifactGraph,
                  world.instance
                )
              ).toBeInstanceOf(Error)

              const ast = assertParse(mainCode, world.instance)
              const radius = (await stringToKclExpression(
                '0.2mm',
                world.rustContext
              )) as KclCommandValue
              const codemod = addFillet({
                ast,
                artifactGraph: outcome.artifactGraph,
                variables: outcome.variables,
                selection: {
                  graphSelections: [
                    { entityRef: reference, codeRef: output.codeRef },
                  ],
                  otherSelections: [],
                },
                radius,
                wasmInstance: world.instance,
              })
              if (codemod instanceof Error) throw codemod
              const edit = recast(codemod.modifiedAst, world.instance)
              if (edit instanceof Error) throw edit
              assertParse(edit, world.instance)
              expect(edit).toContain(
                'import finished from "lineage-two-cut-part.kcl"'
              )
              expect(edit).toMatch(/fillet\(\s*finished\[0\]/)
              expect(edit).toContain(
                'finished[0].history.extrusions[0].wallFaces.side0'
              )
              expect(edit).toContain(
                'finished[0].history.extrusions[0].capFaces.end'
              )
              expect(edit).toContain(
                'finished[0].history.extrusions[2].wallFaces.side3'
              )
              expect(edit).not.toContain('cutDepth')
              expect(edit).not.toMatch(/edgeId|faceId/)
              const auditLog = process.env.SELECT_ANYTHING_ENGINE_AUDIT_LOG
              const auditStart = auditLog
                ? readFileSync(auditLog, 'utf8').length
                : 0
              // Dropping end-face narrowing admits several top fragments.
              const singletonCut = { require_unique_edge: true }
              const sidePairs = edges.map(({ reference }) => ({
                side_faces: reference.side_faces,
              }))
              await expect(
                send({
                  type: 'modeling_cmd_req',
                  cmd_id: uuid(),
                  cmd: {
                    type: 'solid3d_cut_edge_references',
                    object_id: output.id,
                    edges_references: sidePairs,
                    ...singletonCut,
                    cut_type: { fillet: { radius: 0.2 } },
                    tolerance: 1e-7,
                    strategy: 'automatic',
                    extra_face_ids: [],
                  },
                })
              ).resolves.toEqual([
                expect.objectContaining({
                  success: false,
                  errors: expect.arrayContaining([
                    expect.objectContaining({
                      message: expect.stringContaining('exactly one edge'),
                    }),
                  ]),
                }),
              ])
              await world.rustContext.execute(
                assertParse(edit, world.instance),
                {},
                mainPath
              )
              const cutTargetsSince = (offset: number) =>
                auditLog
                  ? readFileSync(auditLog, 'utf8')
                      .slice(offset)
                      .split('\n')
                      .filter((line) =>
                        line.startsWith('SELECT_ANYTHING_CUT_TARGETS ')
                      )
                      .map((line) =>
                        JSON.parse(
                          line.slice('SELECT_ANYTHING_CUT_TARGETS '.length)
                        )
                      )
                  : []
              if (auditLog) {
                expect(cutTargetsSince(auditStart)).toEqual([
                  { body: output.id, edges: [narrowed[0].id] },
                ])
              }
              await world.rustContext.clearSceneAndBustCache({}, mainPath)
              const freshAuditStart = auditLog
                ? readFileSync(auditLog, 'utf8').length
                : 0
              const fresh = await world.rustContext.execute(
                assertParse(edit, world.instance),
                {},
                mainPath
              )
              const freshOutput = fresh.variables[exportedName]
              expect(freshOutput?.type).toBe('HomArray')
              if (auditLog && freshOutput?.type === 'HomArray') {
                const body = freshOutput.value[0]
                if (body?.type !== 'Solid')
                  throw new Error('Missing the fresh subtraction body')
                expect(cutTargetsSince(freshAuditStart)).toEqual([
                  { body: body.value.id, edges: [expect.any(String)] },
                ])
              }
              for (const liveId of Object.keys(secondLineage.sources)) {
                expect(secondChildren).toContain(liveId)
              }
              expect(
                Object.entries(secondLineage.sources).some(
                  ([liveId, source]) =>
                    source !== undefined &&
                    liveId !== source &&
                    source in firstLineage.sources
                )
              ).toBe(true)
            }
          } else {
            const pattern = [...outcome.artifactGraph.values()].find(
              (artifact) => artifact.type === 'pattern'
            )
            if (pattern?.type !== 'pattern') {
              throw new Error('Missing the imported pattern occurrence')
            }
            expect(pattern.sourceId).toBe(owners[0])
            expect(pattern.copyIds).toEqual(owners.slice(1))
            expect(pattern.copyFaceIds.length).toBeGreaterThan(0)
            for (const face of pattern.copyFaceIds) {
              const owningCopies = owners
                .slice(1)
                .filter((owner) => liveChildren.get(owner)?.includes(face))
              expect(owningCopies).toHaveLength(1)
              expect(liveChildren.get(owners[0])).not.toContain(face)
            }
            const faceSources = pattern.copyFaceSources
            if (process.env.SELECT_ANYTHING_REQUIRE_COPY_LINEAGE) {
              expect(faceSources).toBeDefined()
            }
            if (faceSources) {
              const clonedChamfer = [...outcome.artifactGraph.values()].find(
                (artifact) =>
                  artifact.type === 'edgeCut' &&
                  artifact.subType === 'chamfer' &&
                  artifact.copySourceFaceId
              )
              if (
                clonedChamfer?.type !== 'edgeCut' ||
                !clonedChamfer.copySourceFaceId
              ) {
                throw new Error(
                  'Missing the confirmed clone of the chamfer face'
                )
              }
              const original = outcome.artifactGraph.get(
                clonedChamfer.copySourceFaceId
              )
              expect(original).toMatchObject({
                type: 'edgeCut',
                subType: 'chamfer',
              })
              const chamferFaces = owners.map((owner, index) => {
                if (index === 0) return clonedChamfer.id
                const entries = Object.entries(faceSources).filter(
                  ([copy, source]) =>
                    source === clonedChamfer.id &&
                    liveChildren.get(owner)?.includes(copy)
                )
                expect(entries).toHaveLength(1)
                return entries[0][0]
              })
              expect(
                new Set([clonedChamfer.copySourceFaceId, ...chamferFaces]).size
              ).toBe(4)
              const edit =
                mainCode +
                `
seedFace = faceOf(instances[0], chamferFace = 0)
pickedFace = faceOf(instances[1], chamferFace = 0)
siblingFace = faceOf(instances[2], chamferFace = 0)
pickedSketch = sketch(on = pickedFace) {}
`
              const sketched = await world.rustContext.execute(
                assertParse(edit, world.instance),
                {},
                mainPath
              )
              for (const [index, variable] of [
                'seedFace',
                'pickedFace',
                'siblingFace',
              ].entries()) {
                expect(sketched.variables[variable]).toMatchObject({
                  type: 'Face',
                  value: {
                    id: chamferFaces[index],
                    parentSolid: { solidId: owners[index] },
                  },
                })
              }
              expect([...sketched.artifactGraph.values()]).toContainEqual(
                expect.objectContaining({
                  type: 'sketchBlock',
                  planeId: chamferFaces[1],
                })
              )
              await world.rustContext.clearSceneAndBustCache({}, mainPath)
              const fresh = await world.rustContext.execute(
                assertParse(edit, world.instance),
                {},
                mainPath
              )
              const freshPattern = [...fresh.artifactGraph.values()].find(
                (artifact) => artifact.type === 'pattern'
              )
              const freshFace = fresh.variables.pickedFace
              if (
                freshPattern?.type !== 'pattern' ||
                freshFace?.type !== 'Face'
              ) {
                throw new Error('Missing the replayed sketch support')
              }
              expect(freshFace.value.parentSolid.solidId).toBe(
                freshPattern.copyIds[0]
              )
              const seedId = freshPattern.copyFaceSources?.[freshFace.value.id]
              expect(seedId && fresh.artifactGraph.get(seedId)).toMatchObject({
                type: 'edgeCut',
                subType: 'chamfer',
              })
              expect([...fresh.artifactGraph.values()]).toContainEqual(
                expect.objectContaining({
                  type: 'sketchBlock',
                  planeId: freshFace.value.id,
                })
              )

              const scratchPath = resolve(
                fixtureDirectory!,
                'lineage-copy-tagged.kcl'
              )
              const taggedCode =
                partCode.replace(
                  'length = 2mm)',
                  'length = 2mm, tag = $bevelFace)'
                ) +
                `
taggedSupport = faceOf(beveled, face = beveled.faces.bevelFace)
lineageSupport = faceOf(beveled, chamferFace = 0)
`
              await world.rustContext.sendOpenProject(scratchPath, [
                { id: 0, path: scratchPath, text: taggedCode },
              ])
              await world.rustContext.clearSceneAndBustCache({}, scratchPath)
              const tagged = await world.rustContext.execute(
                assertParse(taggedCode, world.instance),
                {},
                scratchPath
              )
              const tagFace = tagged.variables.taggedSupport
              const lineageFace = tagged.variables.lineageSupport
              if (tagFace?.type !== 'Face' || lineageFace?.type !== 'Face') {
                throw new Error('Missing the editable chamfer support')
              }
              expect(tagFace.value.id).toBe(lineageFace.value.id)
              expect(tagFace.value.parentSolid.solidId).toBe(
                lineageFace.value.parentSolid.solidId
              )
            }
          }
        } finally {
          readFile.mockRestore()
        }
        expect(readFileSync(partPath, 'utf8')).toBe(partCode)
      }
    } finally {
      world.engineCommandManager.tearDown({
        route: 'user-requested',
        initiatedBy: 'client',
      })
    }
  },
  60_000
)
