import { addDistanceGdt } from '@src/lang/modifyAst/gdt'
import {
  getSketchSegmentName,
  getVariableNameFromNodePath,
} from '@src/lang/queryAst'
import type { OkModelingCmdResponse } from '@kittycad/lib'
import {
  createArrayExpression,
  createLiteral,
  createLocalName,
  createVariableDeclaration,
} from '@src/lang/create'
import {
  assertParse,
  getAllOperations,
  recast,
  pathToNodeFromRustNodePath,
} from '@src/lang/wasm'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import { baseUnitToMm } from '@src/lib/utils'
import { getPrimitiveSelectionForEntity } from '@src/lib/selections'
import { enterEditFlow } from '@src/lib/operations'
import { getDistanceFrameDefaults } from '@src/lib/gdtFramePosition'
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
            if (!cmd.entity_id.endsWith('rim'))
              throw new Error('Unexpected adjacent-face primitive lookup')
            response = {
              type: cmd.type,
              data: {
                primitive_index: cmd.entity_id.startsWith('left') ? 1 : 2,
                entity_type: 'edge',
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
      if (code instanceof Error) throw code
      expect(code).toContain(`framePlane = ${plane}`)
      expect(code).toContain('precision = 0')
      expect(code).not.toContain('tolerance =')
      expect(code).toContain('from = edgeId(plate, index = 1)')
      expect(code).toContain('to = edgeId(plate, index = 2)')
      expect(code).not.toContain('faceId(')
      expect(code).toContain(
        explicit
          ? 'framePosition = [0, 0]'
          : !geometry
            ? 'framePosition = [0mm, 22mm]'
            : `framePosition = [0${unit}, ${sign < 0 ? '-' : ''}${unit === 'ft' ? '0.0947' : '28.8521'}${unit}]`
      )
      if (explicit) {
        for (const type of [
          'curve_get_end_points',
          'solid3d_get_all_edge_faces',
        ])
          expect(mock).not.toHaveBeenCalledWith(
            expect.objectContaining({ cmd: expect.objectContaining({ type }) })
          )
      }
      const execution = await enginelessExecutor(
        assertParse(code, instance),
        rustContext
      )
      const operation = getAllOperations(execution.operations).findLast(
        (op) => op.type === 'StdLibCall' && op.name === 'gdt::distance'
      )
      if (!operation || operation.type !== 'StdLibCall')
        throw new Error('Missing distance operation')
      const edit = await enterEditFlow({
        operation,
        code,
        artifactGraph: execution.artifactGraph,
        rustContext,
      })
      if (edit instanceof Error) throw edit
      expect(edit.type).toBe('Find and select command')
      if (explicit) {
        mock.mockClear()
        const edited = await modelingCommandCodemods['GDT Distance'].run({
          ast: assertParse(code, instance),
          kclManager,
          wasmInstance: instance,
          args: {
            objects: { graphSelections: [], otherSelections: [] },
            nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
            framePosition: zero,
            framePlane: plane,
            precision: {
              valueAst: createLiteral(1, instance),
              valueText: '1',
              valueCalculated: '1',
            },
          },
        })
        if (edited instanceof Error) throw edited
        const editedCode = recast(edited.modifiedAst, instance)
        expect(editedCode).toContain('precision = 1')
        expect(editedCode).toContain('framePosition = [0, 0]')
        expect(editedCode).toContain('from = edgeId(plate, index = 1)')
        expect(editedCode).toContain('to = edgeId(plate, index = 2)')
        expect(editedCode).not.toContain('tolerance =')
        expect(mock).not.toHaveBeenCalled()
        await enginelessExecutor(edited.modifiedAst, rustContext)
      }
    } finally {
      mock.mockRestore()
    }
  }
)

it.each(['start', 'end'] as const)(
  'qualifies each %s cap through its multi-region extrusion output',
  async (capType) => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const multiRegionCode = `@settings(kclVersion = 3.0, defaultLengthUnit = ft)

sketch001 = sketch(on = YZ) {
  line1 = line(start = [var -7.87ft, var -4.22ft], end = [var 50.03ft, var -4.22ft])
  line2 = line(start = [var 50.03ft, var -4.22ft], end = [var 50.03ft, var 42.39ft])
  line3 = line(start = [var 50.03ft, var 42.39ft], end = [var -7.87ft, var 42.39ft])
  line4 = line(start = [var -7.87ft, var 42.39ft], end = [var -7.87ft, var -4.22ft])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
  circle1 = circle(start = [var 4.09ft, var 33.01ft], center = [var 2.64ft, var 33.66ft])
  circle2 = circle(start = [var 42.34ft, var 1.64ft], center = [var 43.63ft, var 0ft])
  horizontal([circle2.center, ORIGIN])
  circle3 = circle(start = [var 17.49ft, var 0ft], center = [var 15.07ft, var 0ft])
  horizontal([circle3.center, ORIGIN])
  horizontal([circle3.start, ORIGIN])
  circle4 = circle(start = [var 34.27ft, var 14.9ft], center = [var 28.95ft, var 24.11ft])
}
hidden001 = hide(sketch001)
region001 = region(segments = [sketch001.line4, sketch001.line1])
extrude001 = extrude(
  region001,
  length = 5,
  tagEnd = $capEnd001,
  tagStart = $capStart001,
)

sketch002 = sketch(on = XY) {
  circle1 = circle(start = [var -30.96ft, var -5.03ft], center = [var -35.12ft, var 0ft])
  horizontal([circle1.center, ORIGIN])
  circle2 = circle(start = [var 45.96ft, var 41.1ft], center = [var 41.49ft, var 46.05ft])
  circle3 = circle(start = [var 33.17ft, var -5.83ft], center = [var 29.33ft, var 0ft])
  horizontal([circle3.center, ORIGIN])
}
hidden002 = hide(sketch002)
region002 = region(segments = [sketch002.circle1])
region003 = region(segments = [sketch002.circle3])
region004 = region(segments = [sketch002.circle2])
extrude002 = extrude(
  [region002, region003, region004],
  length = 5,
  tagStart = $capStart002,
  tagEnd = $capEnd002,
)
`
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

it.each([
  { count: 1, mixed: false },
  { count: 3, mixed: false },
  { count: 3, mixed: true },
])(
  'names a variable-less body after resolving $count edges (mixed topology: $mixed)',
  async ({ count, mixed }) => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(
      `@settings(kclVersion = 3.0)
profile = sketch(on = XY) {
  outer = circle(center = [0mm, 0mm], start = [20mm, 0mm])
}
region001 = region(sketch = profile, point = [0mm, 0mm])
extrude(region001, length = 5mm, tagEnd = $end)`,
      instance
    )
    const { artifactGraph: graph } = await enginelessExecutor(ast, rustContext)
    const sweep = [...graph.values()].find((a) => a.type === 'sweep')
    const segment = [...graph.values()].find((a) => a.type === 'segment')
    const path =
      sweep?.type === 'sweep' && sweep.pathId
        ? graph.get(sweep.pathId)
        : undefined
    if (
      sweep?.type !== 'sweep' ||
      segment?.type !== 'segment' ||
      path?.type !== 'path'
    )
      throw new Error('Missing body lineage')
    graph.set('mapped', {
      ...segment,
      id: 'mapped',
      originalSegId: segment.id,
      pathId: path.id,
      codeRef: path.codeRef,
    })
    graph.set('cap', {
      type: 'cap',
      id: 'cap',
      subType: 'end',
      sweepId: sweep.id,
      pathIds: [path.id],
      edgeCutEdgeIds: [],
      faceCodeRef: sweep.codeRef,
      cmdId: sweep.id,
    })
    graph.set('wall', {
      type: 'wall',
      id: 'wall',
      sweepId: sweep.id,
      segId: 'mapped',
      pathIds: [path.id],
      edgeCutEdgeIds: [],
      faceCodeRef: sweep.codeRef,
      cmdId: sweep.id,
    })
    const objects: Selections = {
      graphSelections: Array.from(
        { length: mixed ? 1 : count },
        (_, index) => ({
          entityRef: { type: 'edge', side_faces: ['wall', 'cap'], index },
        })
      ),
      otherSelections: [],
    }
    if (mixed) {
      objects.graphSelections.push({
        entityRef: {
          type: 'edge',
          side_faces: ['engine-only-wall', 'engine-only-cap'],
        },
        engineTopologyFallback: { parentId: sweep.id, primitiveIndex: 1 },
      })
      objects.otherSelections.push({
        type: 'enginePrimitive',
        primitiveType: 'edge',
        entityId: 'engine-only-edge',
        parentEntityId: sweep.id,
        primitiveIndex: 2,
      })
    }
    const result = addDistanceGdt({
      ast,
      artifactGraph: graph,
      objects,
      wasmInstance: instance,
    })
    if (result instanceof Error) throw result
    const code = recast(result.modifiedAst, instance)
    expect(code).toContain('body001 = extrude(')
    expect(code).toContain('body001.faces.end')
    expect(code).not.toContain('%')
    if (mixed) {
      expect(code).toContain('edgeId(body001, index = 1)')
      expect(code).toContain('edgeId(body001, index = 2)')
    }
    await enginelessExecutor(result.modifiedAst, rustContext)
  }
)

it('keeps each unique edge length paired with its frame and inherited font', async () => {
  const { instance, rustContext, kclManager, engineCommandManager } =
    await buildTheWorldAndNoEngineConnection()
  const ast = assertParse(
    `@settings(kclVersion = 3.0)
profile = sketch(on = XY) {
  outer = circle(center = [0mm, 0mm], start = [20mm, 0mm])
}
plate = extrude(region(sketch = profile, point = [0mm, 0mm]), length = 10mm)
labelHeight = 15mm
gdt::note(note = "Large labels", fontSize = labelHeight)`,
    instance
  )
  const { artifactGraph, variables } = await enginelessExecutor(
    ast,
    rustContext
  )
  const sweep = [...artifactGraph.values()].find((a) => a.type === 'sweep')
  if (sweep?.type !== 'sweep') throw new Error('Missing body')
  kclManager.artifactGraph = artifactGraph
  const variableValues = vi
    .spyOn(kclManager, 'variables', 'get')
    .mockReturnValue(variables)
  const mock = vi
    .spyOn(engineCommandManager, 'sendSceneCommand')
    .mockImplementation(async (req) => {
      if (req.type !== 'modeling_cmd_req') throw new Error('Unexpected request')
      const cmd = req.cmd
      let response: OkModelingCmdResponse
      if (cmd.type === 'bounding_box') {
        // Edge bounds are unavailable. Endpoints and owning-body bounds remain usable.
        if (cmd.entity_ids[0]?.startsWith('edge'))
          throw new Error('No edge bounds')
        response = {
          type: cmd.type,
          data: {
            center: { x: 0, y: 0, z: 0 },
            dimensions: { x: 40, y: 40, z: 10 },
          },
        }
      } else if (cmd.type === 'curve_get_end_points') {
        response = {
          type: cmd.type,
          data: {
            start: { x: -5, y: -5, z: -5 },
            end:
              cmd.curve_id === 'edgeX'
                ? { x: 5, y: -5, z: -5 }
                : cmd.curve_id === 'edgeY'
                  ? { x: -5, y: 5, z: -5 }
                  : { x: -5, y: -5, z: 5 },
          },
        }
      } else if (cmd.type === 'entity_get_parent_id') {
        response = { type: cmd.type, data: { entity_id: sweep.id } }
      } else throw new Error(`Unexpected query: ${cmd.type}`)
      return {
        success: true,
        request_id: 'test',
        resp: { type: 'modeling', data: { modeling_response: response } },
      }
    })
  try {
    const result = await modelingCommandCodemods['GDT Distance'].run({
      ast,
      kclManager,
      wasmInstance: instance,
      args: {
        objects: {
          graphSelections: ['edgeX', 'edgeX', 'edgeY', 'edgeZ'].map(
            (engineEntityId) => ({
              engineEntityId,
              entityRef: {
                type: 'edge',
                side_faces: ['sideA', 'sideB'],
                index: ['edgeX', 'edgeY', 'edgeZ'].indexOf(engineEntityId),
              },
              engineTopologyFallback: {
                parentId: sweep.id,
                primitiveIndex: ['edgeX', 'edgeY', 'edgeZ'].indexOf(
                  engineEntityId
                ),
              },
            })
          ),
          otherSelections: [],
        },
        precision: {
          valueAst: createLiteral(0, instance),
          valueText: '0',
          valueCalculated: '0',
          variableName: 'digits',
          variableIdentifierAst: createLocalName('digits'),
          variableDeclarationAst: createVariableDeclaration(
            'digits',
            createLiteral(0, instance)
          ),
          insertIndex: 0,
        },
      },
    })
    if (result instanceof Error) throw result
    const code = recast(result.modifiedAst, instance)
    if (code instanceof Error) throw code
    expect(code.match(/gdt::distance\(/g)).toHaveLength(3)
    expect(code.match(/framePlane = XY/g)).toHaveLength(2)
    expect(code.match(/framePlane = XZ/g)).toHaveLength(1)
    expect(code.match(/framePosition = \[0mm, -61.875mm\]/g)).toHaveLength(1)
    expect(code.match(/framePosition = \[0mm, 61.875mm\]/g)).toHaveLength(2)
    expect(code.match(/fontSize = labelHeight/g)).toHaveLength(4)
    expect(code.match(/digits = 0/g)).toHaveLength(1)
    expect(code.match(/precision = digits/g)).toHaveLength(3)
    await enginelessExecutor(result.modifiedAst, rustContext)
  } finally {
    mock.mockRestore()
    variableValues.mockRestore()
  }
})

it('uses cylindrical face centers when face bounds point to the other side of the body', async () => {
  const { instance, engineCommandManager } =
    await buildTheWorldAndNoEngineConnection()
  const mock = vi
    .spyOn(engineCommandManager, 'sendSceneCommand')
    .mockImplementation(async (req) => {
      if (req.type !== 'modeling_cmd_req') throw new Error('Unexpected request')
      const cmd = req.cmd
      let response: OkModelingCmdResponse
      if (cmd.type === 'bounding_box') {
        const face =
          cmd.entity_ids.length === 1 && cmd.entity_ids[0].startsWith('face')
        response = {
          type: cmd.type,
          data: face
            ? {
                center: {
                  x: cmd.entity_ids[0] === 'faceA' ? -6 : 6,
                  y: 10,
                  z: 0,
                },
                dimensions: { x: 0, y: 0, z: 5 },
              }
            : {
                center: { x: 0, y: 0, z: 0 },
                dimensions: { x: 40, y: 40, z: 5 },
              },
        }
      } else if (cmd.type === 'face_get_center') {
        response = {
          type: cmd.type,
          data: { pos: { x: cmd.object_id === 'faceA' ? -6 : 6, y: -1, z: 0 } },
        }
      } else if (cmd.type === 'entity_get_parent_id') {
        response = { type: cmd.type, data: { entity_id: 'body' } }
      } else throw new Error(`Unexpected query: ${cmd.type}`)
      return {
        success: true,
        request_id: 'test',
        resp: { type: 'modeling', data: { modeling_response: response } },
      }
    })
  try {
    const result = await getDistanceFrameDefaults({
      data: {
        objects: {
          graphSelections: ['faceA', 'faceB'].map((face_id) => ({
            entityRef: { type: 'face', face_id },
          })),
          otherSelections: [],
        },
      },
      mode: 'between',
      engineCommandManager,
      wasmInstance: instance,
    })
    expect(result.framePlane).toBe('XY')
    expect(result.framePosition?.valueText).toBe('[0mm, -28.8521mm]')
  } finally {
    mock.mockRestore()
  }
})
