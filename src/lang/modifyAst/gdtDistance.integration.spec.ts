import { addDistanceGdt } from '@src/lang/modifyAst/gdt'
import {
  getSketchSegmentName,
  getVariableNameFromNodePath,
} from '@src/lang/queryAst'
import multiRegionCode from '@src/lang/modifyAst/fixtures/distance-multi-region.kcl?raw'
import type { OkModelingCmdResponse } from '@kittycad/lib'
import { createArrayExpression, createLiteral } from '@src/lang/create'
import { assertParse, recast } from '@src/lang/wasm'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import { baseUnitToMm } from '@src/lib/utils'
import { getPrimitiveSelectionForEntity } from '@src/lib/selections'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { expect, it, vi } from 'vitest'

it.each([
  { plane: 'XY', unit: 'mm', sign: -1, geometry: true, explicit: false },
  { plane: 'XZ', unit: 'ft', sign: 1, geometry: true, explicit: false },
  { plane: 'YZ', unit: 'mm', sign: -1, geometry: true, explicit: false },
  { plane: 'XZ', unit: 'mm', sign: 1, geometry: false, explicit: false },
  { plane: 'XY', unit: 'mm', sign: -1, geometry: true, explicit: true },
] as const)(
  'creates a distance from viewport rim picks on $plane/$unit (geometry: $geometry, explicit: $explicit)',
  async ({ plane, unit, sign, geometry, explicit }) => {
    const { instance, rustContext, kclManager, engineCommandManager } =
      await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(
      `@settings(defaultLengthUnit = ${unit}, kclVersion = 3.0)
support = offsetPlane(${plane}, offset = 4mm)
profile = sketch(on = support) {
  outer = circle(center = [0mm, 0mm], start = [20mm, 0mm])
  left = circle(center = [-6mm, ${sign}mm], start = [-3mm, ${sign}mm])
  right = circle(center = [6mm, ${sign}mm], start = [9mm, ${sign}mm])
}
plate = extrude(region(sketch = profile, point = [0mm, 10mm]), length = 5mm)`,
      instance
    )
    const { artifactGraph } = await enginelessExecutor(ast, rustContext)
    const sweep = [...artifactGraph.values()].find((a) => a.type === 'sweep')
    if (sweep?.type !== 'sweep' || !sweep.pathId)
      throw new Error('Missing extrusion')
    const engineBodyId = sweep.pathId
    kclManager.artifactGraph = artifactGraph
    kclManager.fileSettings = { defaultLengthUnit: unit }
    const point = (x: number, y: number) =>
      plane === 'XY'
        ? { x, y, z: 0 }
        : plane === 'XZ'
          ? { x, y: 0, z: y }
          : { x: 0, y: x, z: y }
    const normal =
      plane === 'XY'
        ? { x: 0, y: 0, z: 1 }
        : plane === 'XZ'
          ? { x: 0, y: 1, z: 0 }
          : { x: 1, y: 0, z: 0 }
    const x = (id: string) => (id === 'left-rim' ? -6 : 6)
    const mock = vi
      .spyOn(engineCommandManager, 'sendSceneCommand')
      .mockImplementation(async (command) => {
        if (command.type !== 'modeling_cmd_req')
          throw new Error('Unexpected request')
        const cmd = command.cmd
        let response: OkModelingCmdResponse
        // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- Other engine commands should fail this mock.
        switch (cmd.type) {
          case 'entity_get_parent_id':
            response = { type: cmd.type, data: { entity_id: engineBodyId } }
            break
          case 'entity_get_primitive_index':
            response = {
              type: cmd.type,
              data: {
                primitive_index:
                  cmd.entity_id === 'cap'
                    ? 0
                    : cmd.entity_id.startsWith('left')
                      ? 1
                      : 2,
                entity_type: cmd.entity_id.endsWith('rim') ? 'edge' : 'face',
              },
            }
            break
          case 'solid3d_get_all_edge_faces':
            expect(cmd.object_id).toBe(engineBodyId)
            response = {
              type: cmd.type,
              data: { faces: ['cap', `${cmd.edge_id}-wall`] },
            }
            break
          case 'face_is_planar':
            if (!geometry) throw new Error('Geometry unavailable')
            response = {
              type: cmd.type,
              data:
                cmd.object_id === 'cap'
                  ? { z_axis: normal, origin: point(0, 0) }
                  : {},
            }
            break
          case 'curve_get_type':
            response = { type: cmd.type, data: { curve_type: 'nurbs' } }
            break
          case 'curve_get_end_points':
            if (!geometry) throw new Error('Geometry unavailable')
            response = {
              type: cmd.type,
              data: {
                start: point(x(cmd.curve_id), sign + 3),
                end: point(x(cmd.curve_id), sign + 3),
              },
            }
            break
          case 'curve_get_control_points':
            response = {
              type: cmd.type,
              data: {
                control_points: [
                  [0, 3],
                  [3, 3],
                  [3, 0],
                  [3, -3],
                  [0, -3],
                  [-3, -3],
                  [-3, 0],
                  [-3, 3],
                  [0, 3],
                ].map(([dx, dy]) => point(x(cmd.curve_id) + dx, sign + dy)),
              },
            }
            break
          case 'bounding_box': {
            if (!geometry) throw new Error('Geometry unavailable')
            const scale = baseUnitToMm(cmd.output_unit ?? 'mm')
            const body =
              !cmd.entity_ids.length || cmd.entity_ids[0] === engineBodyId
            response = {
              type: cmd.type,
              data: {
                center: body
                  ? point(0, 0)
                  : point(
                      (cmd.entity_ids.length === 2 ? 0 : x(cmd.entity_ids[0])) /
                        scale,
                      (sign + 3) / scale
                    ),
                dimensions: body
                  ? {
                      x: (normal.x ? 5 : 40) / scale,
                      y: (normal.y ? 5 : 40) / scale,
                      z: (normal.z ? 5 : 40) / scale,
                    }
                  : point(cmd.entity_ids.length === 2 ? 12 / scale : 0, 0),
              },
            }
            break
          }
          default:
            throw new Error(`Unexpected geometry query: ${cmd.type}`)
        }
        return [
          {
            success: true,
            request_id: 'test',
            resp: { type: 'modeling', data: { modeling_response: response } },
          },
        ]
      })
    try {
      const picks = await Promise.all(
        ['left-rim', 'right-rim'].map((id) =>
          getPrimitiveSelectionForEntity(
            id,
            engineCommandManager,
            artifactGraph
          )
        )
      )
      const otherSelections = picks.filter((p) => p !== null)
      expect(otherSelections).toHaveLength(2)
      expect(otherSelections[0].parentEntityId).toBe(sweep.id)
      expect(sweep.id).not.toBe(engineBodyId)
      const zero = {
        valueAst: createArrayExpression([
          createLiteral(0, instance),
          createLiteral(0, instance),
        ]),
        valueText: '[0, 0]',
        valueCalculated: '[0, 0]',
      }
      const result = await modelingCommandCodemods['GDT Distance'].run({
        ast,
        kclManager,
        wasmInstance: instance,
        args: {
          objects: { graphSelections: [], otherSelections },
          precision: {
            valueAst: createLiteral(0, instance),
            valueText: '0',
            valueCalculated: '0',
          },
          ...(explicit ? { framePosition: zero, framePlane: 'XY' } : {}),
        },
      })
      if (result instanceof Error) throw result
      const code = recast(result.modifiedAst, instance)
      expect(code).toContain(`framePlane = ${plane}`)
      expect(code).toContain('precision = 0')
      expect(code).not.toContain('tolerance =')
      expect(code).not.toContain('edgeId(')
      expect(code).toContain('sideFaces = [')
      expect(code).toContain('faceId(plate, index = ')
      expect(code).toContain(
        explicit
          ? 'framePosition = [0, 0]'
          : !geometry
            ? 'framePosition = [0mm, 22mm]'
            : `framePosition = [0${unit}, ${sign < 0 ? '-' : ''}${unit === 'ft' ? '0.0947' : '28.8521'}${unit}]`
      )
      if (explicit) {
        expect(mock).not.toHaveBeenCalledWith(
          expect.objectContaining({
            cmd: expect.objectContaining({ type: 'curve_get_end_points' }),
          })
        )
      }
      await enginelessExecutor(result.modifiedAst, rustContext)
    } finally {
      mock.mockRestore()
    }
  }
)

it.each(['start', 'end'] as const)(
  'qualifies each %s cap through its multi-region extrusion output',
  async (capType) => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(multiRegionCode, instance)
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
