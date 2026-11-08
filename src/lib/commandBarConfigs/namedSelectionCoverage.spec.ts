import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { getAstAndArtifactGraph } from '@src/lib/testHelpers'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { type Program, recast } from '@src/lang/wasm'
import { isErr } from '@src/lib/trap'
import { getSelectionReferences, selectionBodyFace } from '@src/lib/selections'
import { sketchBlockOnExtrudedFace } from '@src/lang/modifyAst/legacySketchFace'
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

// Bounded model: nine instance expressions x two treatment orders. Each program
// enumerates all four named walls, both named caps and both treatment faces.
// The edge oracle uses an untouched cap/wall intersection, never primitive indices.
const instances = [
  { name: 'original', setup: 'copy = seed', expression: 'copy' },
  {
    name: 'clone',
    setup: 'copy = clone(seed) |> translate(y = 50mm)',
    expression: 'copy',
  },
  {
    name: 'mirror',
    setup: 'copy = mirror3d(seed, across = YZ)',
    expression: 'copy',
  },
  {
    name: 'pattern-original',
    setup:
      'copies = patternLinear3d(seed, instances = 3, distance = 50mm, axis = X)',
    expression: 'copies[0]',
  },
  {
    name: 'pattern-second-copy',
    setup:
      'copies = patternLinear3d(seed, instances = 3, distance = 50mm, axis = X)',
    expression: 'copies[2]',
  },
  {
    name: 'circular-second-copy',
    setup:
      'copies = patternCircular3d(seed, instances = 3, axis = Z, center = [0mm, 0mm, 0mm], arcDegrees = 360deg)',
    expression: 'copies[2]',
  },
  {
    name: 'mirror-pattern-copy',
    setup:
      'copies = patternLinear3d(seed, instances = 3, distance = 50mm, axis = X)\ncopy = mirror3d(copies[2], across = YZ)',
    expression: 'copy',
  },
  {
    name: 'pattern-clone',
    setup:
      'copy = clone(seed) |> translate(y = 50mm)\ncopies = patternLinear3d(copy, instances = 3, distance = 50mm, axis = X)',
    expression: 'copies[2]',
  },
  {
    name: 'clone-mirror',
    setup:
      'mirrored = mirror3d(seed, across = YZ)\ncopy = clone(mirrored) |> translate(y = 50mm)',
    expression: 'copy',
  },
]
const selectors = [
  ...['bottom', 'right', 'top', 'left'].map((name) => ({
    name: `wall-${name}`,
    expr: `target.sketch.tags.${name}`,
    planar: true,
  })),
  ...['startCap', 'endCap', 'chamferFace', 'filletFace'].map((name) => ({
    name,
    expr: `target.faces.${name}`,
    planar: name !== 'filletFace',
  })),
]
const base = `@settings(kclVersion = 3.0)
profile = sketch(on = XY) {
 bottom = line(start = [0mm, 0mm], end = [30mm, 0mm])
 right = line(start = [30mm, 0mm], end = [30mm, 20mm])
 top = line(start = [30mm, 20mm], end = [0mm, 20mm])
 left = line(start = [0mm, 20mm], end = [0mm, 0mm])
}
region001 = region(point = [15mm, 10mm], sketch = profile)
body = extrude(region001, length = 12mm, tagStart = $startCap, tagEnd = $endCap)
`
const treatment = (input: string) => `
chamfer001 = chamfer(${input}, edges = [{sideFaces = [${input}.sketch.tags.bottom, ${input}.faces.endCap]}], length = 1mm, tag = $chamferFace)
fillet001 = fillet(chamfer001, edges = [{sideFaces = [chamfer001.sketch.tags.top, chamfer001.faces.endCap]}], radius = 1mm, tag = $filletFace)
`
const cases = instances.flatMap((instance) =>
  [true, false].map((before) => ({ ...instance, before }))
)
it.each(cases)(
  'bounded named references: $name (treatments before copy: $before)',
  async ({ name, setup, expression, before }) => {
    const code =
      base +
      (before
        ? treatment('body') +
          '\nseed = fillet001\n' +
          setup +
          '\ntarget = ' +
          expression
        : '\nseed = body\n' +
          setup +
          '\nselectedCopy = ' +
          expression +
          '\n' +
          treatment('selectedCopy') +
          '\ntarget = fillet001') +
      '\n' +
      selectors
        .map((s, i) =>
          s.planar
            ? `probe${i} = faceOf(target, face = ${s.expr})`
            : `gdt::annotation(faces = [${s.expr}], annotation = "fillet oracle", framePlane = XZ)`
        )
        .join('\n') +
      `\ngdt::annotation(edges = [{sideFaces = [target.sketch.tags.right, target.faces.startCap]}], annotation = "edge oracle", framePlane = XZ)\n`
    const sent = vi.spyOn(world.engineCommandManager, 'sendCommand')
    const commands = () =>
      sent.mock.calls.flatMap(([, m]) =>
        m.command.type === 'modeling_cmd_req'
          ? [m.command.cmd]
          : m.command.type === 'modeling_cmd_batch_req'
            ? m.command.requests.map((r) => r.cmd)
            : []
      )
    try {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        world.instance,
        world.kclManager
      )
      expect(
        world.kclManager.errors,
        'independent named-reference fixture must execute'
      ).toEqual([])
      const probes = selectors.map((s, i) => {
        if (!s.planar) {
          const oracle = commands().find(
            (c) =>
              c.type === 'new_annotation' &&
              c.options.feature_control?.prefix === 'fillet oracle'
          )
          const target = world.kclManager.variables.target
          if (
            oracle?.type !== 'new_annotation' ||
            !oracle.options.feature_control?.entity_id ||
            target?.type !== 'Solid'
          )
            throw new Error('Missing non-planar oracle')
          return {
            ...s,
            face: {
              id: oracle.options.feature_control.entity_id,
              parentSolid: { solidId: target.value.id },
            },
          }
        }
        const value = world.kclManager.variables[`probe${i}`]
        if (value?.type !== 'Face') throw new Error(`Missing oracle ${s.name}`)
        return { ...s, face: value.value }
      })
      const edgeOracle = commands().find(
        (c) =>
          c.type === 'new_annotation' &&
          c.options.feature_control?.prefix === 'edge oracle'
      )
      if (edgeOracle?.type !== 'new_annotation')
        throw new Error('Missing edge oracle')
      const expectedEdge = edgeOracle.options.feature_control?.edge_reference
      if (!expectedEdge) throw new Error('Missing structural edge oracle')
      let modifiedAst: Node<Program> = ast
      const sketches: { name: string; faceId: string; bodyId: string }[] = []
      for (const p of probes) {
        const selection = {
          entityRef: { type: 'face' as const, face_id: p.face.id },
        }
        const refs = await getSelectionReferences({
          graphSelections: [
            {
              ...selection,
              codeRef: getCodeRefsByArtifactId(p.face.id, artifactGraph)?.[0],
            },
          ],
          defaultPlaneSelections: [],
          enginePrimitives: [],
          artifactGraph,
          engineCommandManager: world.engineCommandManager,
          kclManager: world.kclManager,
          wasmInstance: world.instance,
        })
        console.info(
          'NAMED_REFERENCE_RESULT',
          JSON.stringify({
            instance: name,
            before,
            selector: p.name,
            codes: refs.map((r) => r.code),
          })
        )
        expect.soft(refs.length, `${p.name}: copy-reference capability`).toBe(1)
        expect
          .soft(refs[0]?.code, `${p.name}: named reference required`)
          .not.toMatch(/\b(?:faceId|edgeId)\s*\(/)
        try {
          const note = await modelingCommandCodemods['GDT Annotation'].run({
            ast: modifiedAst,
            kclManager: world.kclManager,
            wasmInstance: world.instance,
            args: {
              objects: { graphSelections: [selection], otherSelections: [] },
              annotation: p.name,
              framePlane: 'XZ',
            },
          })
          if (isErr(note)) throw note
          modifiedAst = note.modifiedAst
          if (p.planar) {
            const plane = await selectionBodyFace(
              p.face.id,
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
            if (!plane) throw new Error('No planar support')
            const sketch = sketchBlockOnExtrudedFace(
              modifiedAst,
              selection,
              plane.sketchPathToNode,
              plane.extrudePathToNode,
              artifactGraph,
              world.instance
            )
            if (isErr(sketch)) throw sketch
            modifiedAst = sketch.modifiedAst
            const item = modifiedAst.body[sketch.pathToNode[1][0] as number]
            if (item.type !== 'VariableDeclaration')
              throw new Error('No sketch declaration')
            sketches.push({
              name: item.declaration.id.name,
              faceId: p.face.id,
              bodyId: p.face.parentSolid.solidId,
            })
          }
        } catch (error) {
          expect.soft(error, `${p.name}: codemod capability`).toBeUndefined()
        }
      }
      const sideFaces = [probes[1].face.id, probes[4].face.id]
      const edgeSelection = {
        entityRef: { type: 'edge' as const, side_faces: sideFaces },
      }
      const edgeRefs = await getSelectionReferences({
        graphSelections: [edgeSelection],
        defaultPlaneSelections: [],
        enginePrimitives: [],
        artifactGraph,
        engineCommandManager: world.engineCommandManager,
        kclManager: world.kclManager,
        wasmInstance: world.instance,
      })
      expect.soft(edgeRefs.length, 'named structural edge reference').toBe(1)
      expect.soft(edgeRefs[0]?.code).not.toMatch(/\b(?:faceId|edgeId)\s*\(/)
      const edgeNote = await modelingCommandCodemods['GDT Annotation'].run({
        ast: modifiedAst,
        kclManager: world.kclManager,
        wasmInstance: world.instance,
        args: {
          objects: { graphSelections: [edgeSelection], otherSelections: [] },
          annotation: 'generated edge',
          framePlane: 'XZ',
        },
      })
      if (isErr(edgeNote)) throw edgeNote
      const output = recast(edgeNote.modifiedAst, world.instance)
      if (isErr(output)) throw output
      expect
        .soft(
          output,
          'codemods must not hide missing named references with indices'
        )
        .not.toMatch(/\b(?:faceId|edgeId)\s*\(/)
      sent.mockClear()
      await getAstAndArtifactGraph(
        output.replace(
          /(sketch\d+ = sketch\(on = faceOf[^\n]+\) \{)\n/g,
          '$1\n circle(start = [0.1mm, 0mm], center = [0mm, 0mm])\n'
        ),
        world.instance,
        world.kclManager
      )
      expect(world.kclManager.errors, output).toEqual([])
      for (const p of probes) {
        expect
          .soft(commands(), `${p.name}: actual annotation target`)
          .toContainEqual(
            expect.objectContaining({
              type: 'new_annotation',
              options: expect.objectContaining({
                feature_control: expect.objectContaining({
                  prefix: p.name,
                  entity_id: p.face.id,
                }),
              }),
            })
          )
      }
      const generatedEdge = commands().find(
        (c) =>
          c.type === 'new_annotation' &&
          c.options.feature_control?.prefix === 'generated edge'
      )
      if (generatedEdge?.type !== 'new_annotation')
        throw new Error('Missing generated edge annotation')
      expect
        .soft(
          generatedEdge.options.feature_control?.edge_reference?.side_faces
            ?.slice()
            .sort(),
          'actual structural edge faces'
        )
        .toEqual(expectedEdge.side_faces.slice().sort())
      console.info(
        'NAMED_GEOMETRY_RESULT',
        JSON.stringify({
          instance: name,
          before,
          faces: probes.length,
          sketches: sketches.length,
          edges: 1,
        })
      )
      for (const s of sketches) {
        expect
          .soft(
            world.kclManager.variables[s.name],
            `${s.name}: actual sketch support`
          )
          .toMatchObject({
            type: 'Object',
            value: {
              meta: {
                value: {
                  sketch: {
                    value: {
                      on: { id: s.faceId, parentSolid: { solidId: s.bodyId } },
                    },
                  },
                },
              },
            },
          })
      }
    } finally {
      sent.mockRestore()
    }
  },
  120000
)

// Reduced contracts: original references should use body-qualified sketch tags;
// copied walls should yield a named reference when direct KCL already exists.
it.each([
  { name: 'original', expression: 'body' },
  { name: 'pattern copy', expression: 'copies[2]' },
])(
  'uses a body-qualified named wall reference: $name',
  async ({ expression }) => {
    const code =
      base +
      `
copies = patternLinear3d(body, instances = 3, distance = 50mm, axis = X)
probe = faceOf(${expression}, face = ${expression}.sketch.tags.right)
`
    const { artifactGraph } = await getAstAndArtifactGraph(
      code,
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors).toEqual([])
    const probe = world.kclManager.variables.probe
    if (probe?.type !== 'Face')
      throw new Error('Missing direct named reference oracle')
    const refs = await getSelectionReferences({
      graphSelections: [
        {
          entityRef: { type: 'face', face_id: probe.value.id },
          codeRef: getCodeRefsByArtifactId(probe.value.id, artifactGraph)?.[0],
        },
      ],
      defaultPlaneSelections: [],
      enginePrimitives: [],
      artifactGraph,
      engineCommandManager: world.engineCommandManager,
      kclManager: world.kclManager,
      wasmInstance: world.instance,
    })
    expect(refs).toHaveLength(1)
    expect(refs[0].code).toContain('.sketch.tags.right')
    expect(refs[0].code).not.toMatch(/\b(?:faceId|edgeId)\s*\(/)
  },
  60000
)
