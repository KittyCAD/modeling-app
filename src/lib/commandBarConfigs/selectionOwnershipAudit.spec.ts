import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { getAstAndArtifactGraph } from '@src/lib/testHelpers'
import { recast } from '@src/lang/wasm'
import { isErr } from '@src/lib/trap'
import { selectionBodyFace } from '@src/lib/selections'
import {
  sketchOnExtrudedFace,
  sketchBlockOnExtrudedFace,
} from '@src/lang/modifyAst/legacySketchFace'
import { addTagForSketchOnFace } from '@src/lang/std/sketch'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
let world: Awaited<ReturnType<typeof buildTheWorldAndConnectToEngine>>
beforeAll(async () => {
  world = await buildTheWorldAndConnectToEngine({
    webrtc: false,
    geometryOnly: true,
  })
})
afterAll(() =>
  world?.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
)
const chainedTreatmentCode = `@settings(kclVersion = 3.0)
profile = sketch(on = XY) {
  bottom = line(start = [0mm, 0mm], end = [30mm, 0mm])
  right = line(start = [30mm, 0mm], end = [30mm, 20mm])
  top = line(start = [30mm, 20mm], end = [0mm, 20mm])
  left = line(start = [0mm, 20mm], end = [0mm, 0mm])
}
region001 = region(point = [15mm, 10mm], sketch = profile)
body = extrude(region001, length = 12mm, tagEnd = $topCap)
chamfer001 = chamfer(body, edges = [{ sideFaces = [region001.tags.bottom, body.faces.topCap] }], length = 1mm, tag = $chamferFace01)
fillet001 = fillet(chamfer001, edges = [{ sideFaces = [region001.tags.top, body.faces.topCap] }], radius = 1mm, tag = $filletFace01)
hide(profile)
gdt::annotation(faces = [chamferFace01], annotation = "chamf", fontSize = 1.4933mm)
gdt::annotation(faces = [filletFace01], annotation = "fillet", fontSize = 1.4933mm)
`

const legacyCode = `@settings(defaultLengthUnit = mm, kclVersion = 1.0)
region001 = startSketchOn(XY) |> startProfile(at = [0, 0]) |> line(end = [30, 0], tag = $bottom) |> line(end = [0, 20], tag = $right) |> line(end = [-30, 0], tag = $top) |> close()
body = extrude(region001, length = 12, tagEnd = $topCap)
chamfer001 = chamfer(body, edges = [{sideFaces = [region001.tags.bottom, body.faces.topCap]}], length = 1, tag = $chamferFace01)
fillet001 = chamfer001
`
const patternSetup =
  'copies = patternLinear3d(fillet001, instances = 3, distance = 50mm, axis = X)'
it.each([
  {
    name: 'chamfer one pattern copy',
    setup: patternSetup,
    operation:
      'chamfer(copies[1], length = 0.5mm, edges = [{sideFaces = [copies[1].sketch.tags.bottom, copies[1].sketch.tags.left]}], tag = $addedFace)',
  },
  {
    name: 'new chamfer face on one pattern copy',
    setup: patternSetup,
    operation:
      'chamfer(copies[1], length = 0.5mm, edges = [{sideFaces = [copies[1].sketch.tags.bottom, copies[1].sketch.tags.left]}], tag = $addedFace)',
    face: 'target.faces.addedFace',
  },
  {
    name: 'fillet one pattern copy',
    setup: patternSetup,
    operation:
      'fillet(copies[1], radius = 0.5mm, edges = [{sideFaces = [copies[1].sketch.tags.bottom, copies[1].sketch.tags.left]}], tag = $addedFace)',
  },
  {
    name: 'shell one pattern copy',
    simple: true,
    face: 'target.sketch.tags.bottom',
    setup: patternSetup.replace('fillet001', 'body'),
    operation:
      'shell(copies[1], faces = [copies[1].faces.topCap], thickness = 0.3mm)',
  },
  {
    name: 'Boolean one pattern copy',
    simple: true,
    face: 'target.sketch.tags.bottom',
    setup:
      patternSetup.replace('fillet001', 'body') +
      '\ntool = clone(copies[1]) |> translate(x = 10mm, y = 5mm, z = 5mm)',
    operation: 'subtract(copies[1], tools = tool)',
  },
  {
    name: 'mirror a pattern copy',
    setup: patternSetup,
    operation: 'mirror3d(copies[2], across = YZ)',
  },
  {
    name: 'pattern a clone',
    setup:
      'seed = clone(fillet001) |> translate(y = 40mm)\nnested = patternLinear3d(seed, instances = 3, distance = 50mm, axis = X)',
    operation: 'nested[2]',
  },
  {
    name: 'clone a mirrored body',
    setup: 'seed = mirror3d(fillet001, across = YZ)',
    operation: 'clone(seed) |> translate(y = 40mm)',
  },
  {
    name: 'legacy copied wall',
    setup: patternSetup,
    operation: 'copies[2]',
    legacy: true,
    face: 'target.sketch.tags.bottom',
  },
  {
    name: 'legacy copied chamfer',
    setup: patternSetup,
    operation: 'copies[2]',
    legacy: true,
  },
])(
  'preserves selection ownership: $name',
  async ({
    setup,
    operation,
    legacy = false,
    simple = false,
    face = 'target.faces.chamferFace01',
  }) => {
    const code =
      (legacy
        ? legacyCode
        : simple
          ? chainedTreatmentCode.split('chamfer001 =')[0]
          : chainedTreatmentCode) +
      `\n${setup}\ntarget = ${operation}\nprobe = faceOf(target, face = ${face})\n`
    const { ast, artifactGraph } = await getAstAndArtifactGraph(
      code,
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors, 'fixture must execute').toEqual([])
    const probe = world.kclManager.variables.probe
    if (probe?.type !== 'Face') throw new Error('Missing expected support face')
    const faceId = probe.value.id
    const plane = await selectionBodyFace(
      faceId,
      artifactGraph,
      ast,
      world.kclManager.execState,
      {
        sceneInfra: world.kclManager.sceneInfra,
        rustContext: world.rustContext,
        sceneEntitiesManager: world.kclManager.sceneEntitiesManager,
        wasmInstance: world.instance,
      }
    )
    expect(plane, 'selected support must be available').toBeDefined()
    if (!plane) throw new Error('Missing plane')
    const sketch = legacy
      ? sketchOnExtrudedFace(
          ast,
          plane.sketchPathToNode,
          plane.extrudePathToNode,
          addTagForSketchOnFace,
          world.instance,
          plane.faceInfo,
          { faceId, artifactGraph }
        )
      : sketchBlockOnExtrudedFace(
          ast,
          { entityRef: { type: 'face', face_id: faceId } },
          plane.sketchPathToNode,
          plane.extrudePathToNode,
          artifactGraph,
          world.instance
        )
    if (isErr(sketch)) throw sketch
    const note = await modelingCommandCodemods['GDT Annotation'].run({
      ast: sketch.modifiedAst,
      kclManager: world.kclManager,
      wasmInstance: world.instance,
      args: {
        objects: {
          graphSelections: [{ entityRef: { type: 'face', face_id: faceId } }],
          otherSelections: [],
        },
        annotation: 'Audit support',
        framePlane: 'XZ',
      },
    })
    if (isErr(note)) throw note
    const output = recast(note.modifiedAst, world.instance)
    if (isErr(output)) throw output
    const sent = vi.spyOn(world.engineCommandManager, 'sendCommand')
    try {
      await getAstAndArtifactGraph(
        legacy
          ? output
          : output.replace(
              /(sketch001 = sketch\(on = faceOf[^\n]+\) \{)\n/,
              '$1\n circle(start = [0.1mm, 0mm], center = [0mm, 0mm])\n'
            ),
        world.instance,
        world.kclManager
      )
      expect(
        world.kclManager.errors,
        'generated references must execute'
      ).toEqual([])
      const support = world.kclManager.variables.sketch001
      expect(support, output).toMatchObject(
        legacy
          ? {
              type: 'Face',
              value: {
                id: faceId,
                parentSolid: { solidId: probe.value.parentSolid.solidId },
              },
            }
          : {
              type: 'Object',
              value: {
                meta: {
                  value: {
                    sketch: {
                      value: {
                        on: {
                          id: faceId,
                          parentSolid: {
                            solidId: probe.value.parentSolid.solidId,
                          },
                        },
                      },
                    },
                  },
                },
              },
            }
      )
      const commands = sent.mock.calls.flatMap(([, m]) =>
        m.command.type === 'modeling_cmd_req'
          ? [m.command.cmd]
          : m.command.type === 'modeling_cmd_batch_req'
            ? m.command.requests.map((r) => r.cmd)
            : []
      )
      expect(commands).toContainEqual(
        expect.objectContaining({
          type: 'new_annotation',
          options: expect.objectContaining({
            feature_control: expect.objectContaining({
              prefix: 'Audit support',
              entity_id: faceId,
            }),
          }),
        })
      )
    } finally {
      sent.mockRestore()
    }
  },
  60000
)
