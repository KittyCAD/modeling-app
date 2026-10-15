import { describe, expect, it, vi } from 'vitest'
import { addDistanceGdt } from '@src/lang/modifyAst/gdt'
import { getSketchSegmentName } from '@src/lang/queryAst'
import { assertParse, isPathToNode, recast } from '@src/lang/wasm'
import holePlateCode from '@src/lang/modifyAst/fixtures/dimension-hole-plate.kcl?raw'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

describe('circular dimensions', () => {
  it.each(
    ['diameter', 'radius'].flatMap((kind) =>
      ['XY', 'XZ', 'YZ'].map((plane) => ({
        kind: kind as 'diameter' | 'radius',
        plane,
      }))
    )
  )(
    'generates and edits a $kind annotation in $plane for a selected cylindrical face',
    async ({ kind, plane }) => {
      const point = (x: number, y: number, z: number) =>
        plane === 'XY'
          ? { x, y, z }
          : plane === 'XZ'
            ? { x, y: z, z: y }
            : { x: z, y: x, z: y }
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndNoEngineConnection()
      const ast = assertParse(
        `@settings(kclVersion = 2.0)
profile = sketch(on = ${plane}) {
  rim = ${
    kind === 'diameter'
      ? 'circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])'
      : 'arc(start = [var 10mm, var 0mm], end = [var -10mm, var 0mm], center = [var 0mm, var 0mm])\n  closing = line(start = [var -10mm, var 0mm], end = [var 10mm, var 0mm])'
  }
}
profileRegion = region(segments = [profile.rim${kind === 'radius' ? ', profile.closing' : ''}])
solid = extrude(profileRegion, length = 5mm)`,
        instance
      )
      const { artifactGraph } = await enginelessExecutor(ast, rustContext)
      const sweep = [...artifactGraph.values()].find((a) => a.type === 'sweep')
      if (sweep?.type !== 'sweep' || !sweep.pathId)
        throw new Error('Missing extrusion')
      const path = artifactGraph.get(sweep.pathId)
      if (path?.type !== 'path') throw new Error('Missing region')
      const source = [...artifactGraph.values()].find(
        (a) =>
          a.type === 'segment' &&
          getSketchSegmentName(ast, a.id, artifactGraph, instance) === 'rim'
      )
      if (source?.type !== 'segment')
        throw new Error('Missing circular segment')
      const segId = 'rim-segment'
      artifactGraph.set(segId, {
        ...source,
        id: segId,
        originalSegId: source.id,
        pathId: path.id,
        codeRef: path.codeRef,
      })
      const wall = {
        type: 'wall' as const,
        id: 'rim-face',
        sweepId: sweep.id,
        segId,
        pathIds: [path.id],
        edgeCutEdgeIds: [],
        faceCodeRef: sweep.codeRef,
        cmdId: sweep.id,
      }
      artifactGraph.set(wall.id, wall)
      kclManager.artifactGraph = artifactGraph
      const mock = vi
        .spyOn(engineCommandManager, 'sendSceneCommand')
        .mockImplementation(async (command) => {
          if (command.type !== 'modeling_cmd_req')
            throw new Error('Unsupported geometry query')
          const cmd = command.cmd
          if (cmd.type !== 'face_get_position') {
            const responses = {
              face_get_gradient: {
                df_du: { x: 1, y: 0, z: 0 },
                df_dv: point(0, 0, 5),
                normal: { x: 0, y: 1, z: 0 },
              },
              entity_get_parent_id: { entity_id: sweep.id },
              entity_get_all_child_uuids: { entity_ids: ['rim'] },
              get_entity_type: { entity_type: 'edge' },
              solid3d_get_all_edge_faces: { faces: [wall.id] },
              curve_get_type: { curve_type: 'arc' },
              curve_get_end_points: {
                start: { x: 10, y: 0, z: 0 },
                end: { x: kind === 'diameter' ? 10 : -10, y: 0, z: 0 },
              },
              curve_get_control_points: {
                control_points: [
                  { x: 10, y: 0, z: 0 },
                  { x: 10, y: 10, z: 0 },
                  { x: 0, y: 10, z: 0 },
                  { x: -10, y: 10, z: 0 },
                  { x: -10, y: 0, z: 0 },
                  ...(kind === 'diameter'
                    ? [
                        { x: -10, y: -10, z: 0 },
                        { x: 0, y: -10, z: 0 },
                        { x: 10, y: -10, z: 0 },
                        { x: 10, y: 0, z: 0 },
                      ]
                    : []),
                ].map((p) => point(p.x, p.y, p.z)),
              },
            }
            return {
              success: true,
              resp: {
                type: 'modeling',
                data: {
                  modeling_response: {
                    type: cmd.type,
                    data: responses[cmd.type as keyof typeof responses],
                  },
                },
              },
            } as Awaited<
              ReturnType<typeof engineCommandManager.sendSceneCommand>
            >
          }
          const { x, y } = cmd.uv
          const angle = x
          return {
            success: true,
            resp: {
              type: 'modeling',
              data: {
                modeling_response: {
                  type: 'face_get_position',
                  data: {
                    pos: point(
                      10 * Math.cos(angle),
                      10 * Math.sin(angle),
                      y * 5
                    ),
                  },
                },
              },
            },
          }
        })
      let result
      try {
        result = await modelingCommandCodemods['GDT Distance'].run({
          ast,
          args: {
            objects: {
              graphSelections: [{ artifact: wall, codeRef: sweep.codeRef }],
              otherSelections: [],
            },
          },
          kclManager,
          wasmInstance: instance,
        })
      } finally {
        mock.mockRestore()
      }
      if (result instanceof Error) throw result
      const code = recast(result.modifiedAst, instance)
      expect(code).toContain(`gdt::${kind}(`)
      expect(code).toContain('target = profileRegion.tags.rim')
      expect(code).toContain(`framePlane = ${plane}`)
      expect(code).toContain(
        `framePosition = [${kind === 'diameter' ? -12 : 12}, 7.5]`
      )
      expect(code).not.toContain('tolerance =')
      await enginelessExecutor(result.modifiedAst, rustContext)

      if (!isPathToNode(result.pathToNode))
        throw new Error('Expected a single annotation path')

      const edited = addDistanceGdt({
        ast: result.modifiedAst,
        artifactGraph,
        wasmInstance: instance,
        nodeToEdit: result.pathToNode,
        dimensionFunction: kind,
        framePlane: 'XZ',
      })
      if (edited instanceof Error) throw edited
      const editedCode = recast(edited.modifiedAst, instance)
      expect(editedCode).toContain(`gdt::${kind}(`)
      expect(editedCode).toContain('target = profileRegion.tags.rim')
      expect(editedCode).toContain('framePlane = XZ')
      await enginelessExecutor(edited.modifiedAst, rustContext)
    }
  )
  it('dimensions the hole rim from issue #13146 with adjacent-face references', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(holePlateCode, instance)
    const { artifactGraph } = await enginelessExecutor(ast, rustContext)
    const sweep = [...artifactGraph.values()].find((a) => a.type === 'sweep')
    if (sweep?.type !== 'sweep' || !sweep.pathId)
      throw new Error('Missing plate')
    const path = artifactGraph.get(sweep.pathId)
    if (path?.type !== 'path') throw new Error('Missing plate region')
    const source = [...artifactGraph.values()].find(
      (a) =>
        a.type === 'segment' &&
        getSketchSegmentName(ast, a.id, artifactGraph, instance) === 'circle4'
    )
    if (source?.type !== 'segment') throw new Error('Missing hole')
    artifactGraph.set('hole-segment', {
      ...source,
      id: 'hole-segment',
      originalSegId: source.id,
      pathId: path.id,
      codeRef: path.codeRef,
    })
    artifactGraph.set('hole-wall', {
      type: 'wall',
      id: 'hole-wall',
      segId: 'hole-segment',
      sweepId: sweep.id,
      pathIds: [path.id],
      edgeCutEdgeIds: [],
      faceCodeRef: sweep.codeRef,
      cmdId: sweep.id,
    })
    artifactGraph.set('plate-top', {
      type: 'cap',
      id: 'plate-top',
      subType: 'end',
      sweepId: sweep.id,
      pathIds: [path.id],
      edgeCutEdgeIds: [],
      faceCodeRef: sweep.codeRef,
      cmdId: sweep.id,
    })
    const result = addDistanceGdt({
      ast,
      artifactGraph,
      wasmInstance: instance,
      dimensionFunction: 'diameter',
      framePlane: 'XY',
      objects: {
        graphSelections: [
          {
            entityRef: { type: 'edge', side_faces: ['hole-wall', 'plate-top'] },
          },
        ],
        otherSelections: [],
      },
    })
    if (result instanceof Error) throw result
    const code = recast(result.modifiedAst, instance)
    if (code instanceof Error) throw code
    expect(code).toContain('gdt::diameter(')
    expect(code.replace(/\s+/g, '')).toContain(
      'target={sideFaces=[region001.tags.circle4,extrude001.faces.capEnd001]}'
    )
    expect(code).not.toContain('edgeId(')
    await enginelessExecutor(result.modifiedAst, rustContext)
  })
})
