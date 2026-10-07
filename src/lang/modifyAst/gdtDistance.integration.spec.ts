import { enginelessExecutor } from '@src/lib/testHelpers'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { addDistanceGdt } from '@src/lang/modifyAst/gdt'
import multiRegionCode from '@src/lang/modifyAst/fixtures/distance-multi-region.kcl?raw'
import {
  getSketchSegmentName,
  getVariableNameFromNodePath,
} from '@src/lang/queryAst'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import { type ArtifactGraph, assertParse, recast } from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it, vi } from 'vitest'

describe('distance edge topology', () => {
  it.each(['start', 'end'] as const)(
    'qualifies each %s cap through its multi-region extrusion output',
    async (capType) => {
      const { instance, rustContext } =
        await buildTheWorldAndNoEngineConnection()
      const ast = assertParse(
        multiRegionCode.slice(0, multiRegionCode.indexOf('gdt::distance(')),
        instance
      )
      const { artifactGraph } = await enginelessExecutor(ast, rustContext)
      const selections: Selections = {
        graphSelections: [],
        otherSelections: [],
      }
      for (const regionName of ['region003', 'region002']) {
        const sweep = [...artifactGraph.values()].find((artifact) => {
          if (artifact.type !== 'sweep' || !artifact.pathId) return false
          const path = artifactGraph.get(artifact.pathId)
          return (
            path?.type === 'path' &&
            getVariableNameFromNodePath(
              path.codeRef.pathToNode,
              ast,
              instance
            ) === regionName
          )
        })
        if (sweep?.type !== 'sweep') throw new Error('Missing extrusion output')
        const path = sweep.pathId && artifactGraph.get(sweep.pathId)
        if (!path || path.type !== 'path')
          throw new Error('Missing region segment')
        // Mock execution retains the real region/sweep lineage but has no
        // engine face topology. Supply the selected faces of each output.
        const capId = `${sweep.id}-${capType}`
        const wallId = `${sweep.id}-wall`
        const source = [...artifactGraph.values()].find(
          (a) =>
            a.type === 'segment' &&
            a.codeRef.range[0] >= multiRegionCode.indexOf('sketch002 =') &&
            getSketchSegmentName(ast, a.id, artifactGraph, instance) ===
              (regionName === 'region003' ? 'circle3' : 'circle1')
        )
        if (source?.type !== 'segment') throw new Error('Missing source circle')
        const segmentId = `${sweep.id}-segment`
        artifactGraph.set(segmentId, {
          ...source,
          id: segmentId,
          originalSegId: source.id,
          pathId: path.id,
          codeRef: path.codeRef,
        })
        artifactGraph.set(capId, {
          type: 'cap',
          id: capId,
          subType: capType,
          sweepId: sweep.id,
          pathIds: [path.id],
          edgeCutEdgeIds: [],
          faceCodeRef: sweep.codeRef,
          cmdId: sweep.id,
        })
        artifactGraph.set(wallId, {
          type: 'wall',
          id: wallId,
          sweepId: sweep.id,
          segId: segmentId,
          pathIds: [path.id],
          edgeCutEdgeIds: [],
          faceCodeRef: sweep.codeRef,
          cmdId: sweep.id,
        })
        selections.graphSelections.push({
          entityRef: { type: 'edge', side_faces: [wallId, capId] },
        })
      }
      const result = addDistanceGdt({
        ast,
        artifactGraph,
        objects: selections,
        framePlane: 'XY',
        wasmInstance: instance,
      })
      if (result instanceof Error) throw result
      const code = recast(result.modifiedAst, instance)
      if (code instanceof Error) throw code
      const compactCode = code.replace(/\s+/g, '')
      const tag = capType === 'end' ? 'capEnd002' : 'capStart002'
      expect(compactCode).toContain(
        `sideFaces=[region003.tags.circle3,extrude002[1].faces.${tag}]`
      )
      expect(compactCode).toContain(
        `sideFaces=[region002.tags.circle1,extrude002[0].faces.${tag}]`
      )
      expect(code).not.toContain('edgeId(')
      await enginelessExecutor(result.modifiedAst, rustContext)
    }
  )
  it.each(
    (['primitive', 'graph', 'mixed'] as const).flatMap((route) =>
      ['XY', 'XZ', 'YZ'].flatMap((plane) =>
        [true, false]
          .map((engineBounds) => ({
            route,
            engineBounds,
            plane,
            measurement: 'holes',
          }))
          .concat([
            { route, engineBounds: true, plane, measurement: 'zEdge' },
            { route, engineBounds: true, plane, measurement: 'depth' },
          ])
      )
    )
  )(
    'generates $measurement on $plane for $route selections with engine bounds $engineBounds',
    async ({ route, engineBounds, plane, measurement }) => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndNoEngineConnection()
      const ast = assertParse(
        `@settings(defaultLengthUnit = mm, kclVersion = 2)
holeSketch = sketch(on = ${plane}) {
  outer = circle(start = [20mm, 0mm], center = [0mm, 0mm])
  leftHole = circle(start = [-3mm, 0mm], center = [-6mm, 0mm])
  rightHole = circle(start = [9mm, 0mm], center = [6mm, 0mm])
}
plate = extrude(region(point = [0mm, 10mm], sketch = holeSketch), length = 5mm)`,
        instance
      )
      const codeRef = {
        nodePath: { steps: [] },
        range: [0, 0, 0] as [number, number, number],
        pathToNode: createPathToNodeForLastVariable(ast),
      }
      const artifactGraph: ArtifactGraph = new Map([
        [
          'plate-body',
          {
            type: 'sweep',
            id: 'plate-body',
            subType: 'extrusion',
            surfaceIds: [],
            edgeIds: [],
            trajectoryId: null,
            method: 'new',
            consumed: false,
            codeRef,
          },
        ],
      ])
      const objects: Selections = { graphSelections: [], otherSelections: [] }
      for (const index of measurement === 'zEdge' ? [1] : [1, 2]) {
        if (route === 'graph' || (route === 'mixed' && index === 1)) {
          objects.graphSelections.push({
            entityRef: {
              type: 'edge',
              side_faces:
                measurement === 'zEdge'
                  ? ['wallX', 'wallY']
                  : [
                      measurement === 'depth'
                        ? index === 1
                          ? 'cap-start'
                          : 'cap-end'
                        : 'cap',
                      `hole-rim-${index}-wall`,
                    ],
            },
            engineEntityId: `hole-rim-${index}`,
            engineTopologyFallback: {
              parentId: 'plate-body',
              primitiveIndex: index,
            },
          })
        } else {
          objects.otherSelections.push({
            type: 'enginePrimitive',
            primitiveType: 'edge',
            parentEntityId: 'plate-body',
            primitiveIndex: index,
            entityId: `hole-rim-${index}`,
          })
        }
      }
      kclManager.artifactGraph = artifactGraph
      const sceneCommand = vi
        .spyOn(engineCommandManager, 'sendSceneCommand')
        .mockImplementation(async (command) => {
          if (command.type !== 'modeling_cmd_req')
            throw new Error('Unexpected command')
          const cmd = command.cmd
          const normal =
            plane === 'XY'
              ? { x: 0, y: 0, z: 1 }
              : plane === 'XZ'
                ? { x: 0, y: 1, z: 0 }
                : { x: 1, y: 0, z: 0 }
          const normalOffset = {
            x: normal.x * 3,
            y: normal.y * 3,
            z: normal.z * 3,
          }
          const capId = (id: string) =>
            measurement === 'depth'
              ? id === 'hole-rim-1'
                ? 'cap-start'
                : 'cap-end'
              : 'cap'
          const sideFaces = (id: string) =>
            measurement === 'zEdge'
              ? ['wallX', 'wallY']
              : [capId(id), id + '-wall']
          let response
          if (cmd.type === 'solid3d_get_all_edge_faces')
            response = {
              type: cmd.type,
              data: { faces: sideFaces(cmd.edge_id) },
            }
          else if (cmd.type === 'entity_get_primitive_index')
            response = {
              type: cmd.type,
              data: {
                primitive_index: cmd.entity_id.startsWith('cap')
                  ? 0
                  : cmd.entity_id.includes('2') || cmd.entity_id === 'wallY'
                    ? 2
                    : 1,
                entity_type: 'face' as const,
              },
            }
          else if (cmd.type === 'entity_get_parent_id')
            response = { type: cmd.type, data: { entity_id: 'plate-body' } }
          else if (cmd.type === 'curve_get_end_points')
            response = {
              type: cmd.type,
              data: {
                start: { x: 0, y: 0, z: 0 },
                end:
                  measurement === 'zEdge'
                    ? { x: 0, y: 0, z: 10 }
                    : { x: 0, y: 0, z: 0 },
              },
            }
          else if (cmd.type === 'face_is_planar')
            response = {
              type: cmd.type,
              data: cmd.object_id.startsWith('cap')
                ? {
                    z_axis: normal,
                    origin:
                      cmd.object_id === 'cap-end'
                        ? normalOffset
                        : { x: 0, y: 0, z: 0 },
                  }
                : {},
            }
          else if (cmd.type === 'bounding_box') {
            if (!engineBounds) throw new Error('Bounds unavailable')
            response = {
              type: cmd.type,
              data: {
                center:
                  cmd.entity_ids[0] === 'hole-rim-1'
                    ? { x: 0, y: 0, z: 0 }
                    : measurement === 'depth'
                      ? normalOffset
                      : plane === 'YZ'
                        ? { x: 0, y: 12, z: 0 }
                        : { x: 12, y: 0, z: 0 },
                dimensions: { x: 100, y: 100, z: 10 },
              },
            }
          } else throw new Error('Unexpected command')
          return {
            success: true,
            request_id: 'test',
            resp: { type: 'modeling', data: { modeling_response: response } },
          }
        })
      const result = await modelingCommandCodemods['GDT Distance'].run({
        ast,
        args: { objects },
        kclManager,
        wasmInstance: instance,
      })
      sceneCommand.mockRestore()
      if (result instanceof Error) throw result
      const code = recast(result.modifiedAst, instance)
      const findings = await instance.kcl_lint(
        JSON.stringify(result.modifiedAst)
      )
      expect(
        findings.filter(
          (finding: { finding: { code?: string } }) =>
            finding.finding.code === 'Z0006'
        )
      ).toEqual([])
      expect(code).not.toContain('edgeId(')
      expect(code).not.toContain('getCommonEdge(')
      expect(code).toContain('sideFaces = [')
      expect(code).toContain('faceId(plate, index = ')
      if (measurement === 'zEdge') expect(code).toContain('edges = [')
      else {
        expect(code).toContain('from = {')
        expect(code).toContain('to = {')
      }
      expect(code).not.toContain('tolerance =')
      const expectedPlane =
        measurement === 'zEdge'
          ? 'XZ'
          : measurement === 'depth'
            ? plane === 'XY'
              ? 'XZ'
              : 'XY'
            : plane
      expect(code).toContain(`framePlane = ${expectedPlane}`)
      await enginelessExecutor(result.modifiedAst, rustContext)
    }
  )
})
