import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { getAstAndArtifactGraph } from '@src/lib/testHelpers'
import { recast } from '@src/lang/wasm'
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

const slab = `
toolSketch = sketch(on = XY) {
 a = line(start = [12mm, -5mm], end = [18mm, -5mm])
 b = line(start = [18mm, -5mm], end = [18mm, 25mm])
 c = line(start = [18mm, 25mm], end = [12mm, 25mm])
 d = line(start = [12mm, 25mm], end = [12mm, -5mm])
}
tool = extrude(region(point = [15mm, 5mm], sketch = toolSketch), length = 20mm)
parts = split(body, tools = tool)
`
const localBody = base.replace('@settings(kclVersion = 3.0)', '')
it.each<{
  name: string
  code: string
  module?: string
  split?: boolean
  face?: string
  cache?: boolean
}>([
  {
    name: 'alias chain',
    code: base + '\nfirst = body\nsecond = first\ntarget = second',
  },
  {
    name: 'unchanged cached alias',
    code: base + '\ntarget = body',
    cache: true,
  },
  {
    name: 'function-local body with shadowed name',
    code:
      '@settings(kclVersion = 3.0)\nbody = 42\nfn make() {\n' +
      localBody +
      '\nreturn body\n}\ntarget = make()',
  },
  {
    name: 'two calls to the same factory',
    code:
      '@settings(kclVersion = 3.0)\nfn make() {\n' +
      localBody +
      '\nreturn body\n}\nfirst = make()\ntarget = make() |> translate(y = 50mm)',
  },
  {
    name: 'imported factory',
    module:
      '@settings(kclVersion = 3.0)\nexport fn make() {\n' +
      localBody +
      '\nreturn body\n}',
    code: '@settings(kclVersion = 3.0)\nimport make from "coverage-module.kcl"\ntarget = make()',
  },
  {
    name: 'imported solid alias',
    module: base.replace('body = extrude', 'export body = extrude'),
    code: '@settings(kclVersion = 3.0)\nimport body as importedBody from "coverage-module.kcl"\ntarget = importedBody',
  },
  ...[0, 1, 2, 3].map((index) => ({
    name: `split output ${index}${index > 1 ? ' (named-tag runtime prerequisite)' : ''}`,
    code: base + slab + `\ntarget = parts[${index}]`,
    split: true,
    face: index === 1 ? 'target.sketch.tags.bottom' : 'target.faces.endCap',
  })),
])(
  'resolves scoped or split support: $name',
  async ({
    code,
    module,
    split = false,
    face = 'target.faces.endCap',
    cache = false,
  }) => {
    const mocks: ReturnType<typeof vi.spyOn>[] = []
    if (module) {
      const { projectFsManager } = await import(
        '@src/lang/std/fileSystemManager'
      )
      mocks.push(
        vi
          .spyOn(projectFsManager, 'readFile')
          .mockImplementation((async (_path: string, options?: unknown) =>
            options
              ? module
              : Buffer.from(module)) as typeof projectFsManager.readFile)
      )
      mocks.push(vi.spyOn(projectFsManager, 'exists').mockResolvedValue(true))
    }
    const sent = vi.spyOn(world.engineCommandManager, 'sendCommand')
    try {
      const candidateExpressions = split
        ? [
            'target.faces.startCap',
            'target.sketch.tags.bottom',
            'target.sketch.tags.right',
            'target.sketch.tags.top',
            'target.sketch.tags.left',
          ]
        : []
      const fixture =
        code +
        `\nprobe = faceOf(target, face = ${face})\n` +
        candidateExpressions
          .map((expr, i) => `candidate${i} = faceOf(target, face = ${expr})`)
          .join('\n')
      let execution = await getAstAndArtifactGraph(
        fixture,
        world.instance,
        world.kclManager
      )
      if (cache)
        execution = await getAstAndArtifactGraph(
          fixture,
          world.instance,
          world.kclManager
        )
      const { ast, artifactGraph } = execution
      if (cache)
        expect(
          artifactGraph.bodyBindings?.some(
            (body) => body.variable === 'target'
          ),
          'cached execution retains public bindings'
        ).toBe(true)
      expect(
        world.kclManager.errors,
        'direct named KCL fixture must execute'
      ).toEqual([])
      if (split) {
        const parts = world.kclManager.variables.parts
        expect(parts?.type).toBe('HomArray')
        if (parts?.type === 'HomArray')
          expect(parts.value.length).toBeGreaterThan(1)
      }
      const probe = world.kclManager.variables.probe
      if (probe?.type !== 'Face') throw new Error('Missing expected support')
      const faceId = probe.value.id
      const target = world.kclManager.variables.target
      if (target?.type !== 'Solid') throw new Error('Missing target body')
      const topology = await world.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: crypto.randomUUID(),
        cmd: { type: 'entity_get_all_child_uuids', entity_id: target.value.id },
      })
      if (
        !isModelingResponse(topology) ||
        topology.resp.data.modeling_response.type !==
          'entity_get_all_child_uuids'
      )
        throw new Error('Missing independent topology oracle')
      if (split)
        console.info(
          'SPLIT_NAMED_INVENTORY',
          JSON.stringify({
            code: code.slice(code.lastIndexOf('target =')),
            primaryFaceIsLive:
              topology.resp.data.modeling_response.data.entity_ids.includes(
                faceId
              ),
            candidates: [0, 1, 2, 3, 4].map((i) => {
              const value = world.kclManager.variables[`candidate${i}`]
              return {
                index: i,
                live:
                  value?.type === 'Face' &&
                  topology.resp.data.modeling_response.type ===
                    'entity_get_all_child_uuids' &&
                  topology.resp.data.modeling_response.data.entity_ids.includes(
                    value.value.id
                  ),
              }
            }),
          })
        )
      const liveFaces = topology.resp.data.modeling_response.data.entity_ids
      if (!liveFaces.includes(faceId)) {
        // Runtime tag inheritance is a separate capability. A reference catalog
        // must fail closed rather than publish that stale tag as an output face.
        const bindings = artifactGraph.bodyBindings?.filter(
          (body) => body.bodyId === target.value.id
        )
        expect(bindings?.length, 'live output is represented').toBeGreaterThan(
          0
        )
        expect(
          bindings?.every((body) =>
            body.faces.every((face) => face.id !== faceId)
          ),
          'stale named face is not advertised'
        ).toBe(true)
        console.info(
          'UNAVAILABLE_NAMED_SELECTOR',
          JSON.stringify({ bodyId: target.value.id, faceId })
        )
        return
      }
      expect(
        liveFaces,
        'direct named face belongs to the selected live body'
      ).toContain(faceId)

      const selection = {
        entityRef: { type: 'face' as const, face_id: faceId },
      }
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
      if (!plane) throw new Error('Missing selectable plane')
      const sketch = sketchBlockOnExtrudedFace(
        ast,
        selection,
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
          objects: { graphSelections: [selection], otherSelections: [] },
          annotation: 'scoped support',
          framePlane: 'XZ',
        },
      })
      if (isErr(note)) throw note
      const output = recast(note.modifiedAst, world.instance)
      if (isErr(output)) throw output
      expect(output).not.toMatch(/\b(?:faceId|edgeId)\s*\(/)
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
      const item = note.modifiedAst.body[sketch.pathToNode[1][0] as number]
      if (item.type !== 'VariableDeclaration') throw new Error('Missing sketch')
      expect(
        world.kclManager.variables[item.declaration.id.name],
        output
      ).toMatchObject({
        type: 'Object',
        value: {
          meta: {
            value: {
              sketch: {
                value: {
                  on: {
                    id: faceId,
                    parentSolid: { solidId: probe.value.parentSolid.solidId },
                  },
                },
              },
            },
          },
        },
      })
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
              prefix: 'scoped support',
              entity_id: faceId,
            }),
          }),
        })
      )
    } finally {
      sent.mockRestore()
      for (const m of mocks) m.mockRestore()
    }
  },
  60000
)

it.each<{
  name: string
  copy: number
  side: string[]
  end?: string[]
  index: number
}>(
  [0, 2].flatMap((copy) => [
    {
      name: `cap boundary index 0 copy ${copy}`,
      copy,
      side: ['endCap'],
      index: 0,
    },
    {
      name: `cap boundary index 2 copy ${copy}`,
      copy,
      side: ['endCap'],
      index: 2,
    },
    {
      name: `end-face restriction copy ${copy}`,
      copy,
      side: ['bottom', 'right'],
      end: ['startCap'],
      index: 0,
    },
  ])
)(
  'preserves structural edge disambiguation: $name',
  async ({ copy, side, end = [], index }) => {
    const faceExpr = (name: string) =>
      ['startCap', 'endCap'].includes(name)
        ? `target.faces.${name}`
        : `target.sketch.tags.${name}`
    const selector = `{sideFaces = [${side.map(faceExpr).join(', ')}], ${end.length ? `endFaces = [${end.map(faceExpr).join(', ')}],` : ''} index = ${index}}`
    const code =
      base +
      `\ncopies = patternLinear3d(body, instances = 3, distance = 50mm, axis = X)\ntarget = copies[${copy}]\n` +
      [...side, ...end]
        .map((n, i) => `probe${i} = faceOf(target, face = ${faceExpr(n)})`)
        .join('\n') +
      `\ngdt::annotation(edges = [${selector}], annotation = "edge oracle", framePlane = XZ)\n`
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
        'structural edge oracle must execute'
      ).toEqual([])
      const ids = [...side, ...end].map((_, i) => {
        const p = world.kclManager.variables[`probe${i}`]
        if (p?.type !== 'Face') throw new Error('Missing face oracle')
        return p.value.id
      })
      const selection = {
        entityRef: {
          type: 'edge' as const,
          side_faces: ids.slice(0, side.length),
          end_faces: ids.slice(side.length),
          index,
        },
      }
      const oracle = commands().find(
        (c) =>
          c.type === 'new_annotation' &&
          c.options.feature_control?.prefix === 'edge oracle'
      )
      if (
        oracle?.type !== 'new_annotation' ||
        !oracle.options.feature_control?.edge_reference
      )
        throw new Error('Missing edge oracle')
      const refs = await getSelectionReferences({
        graphSelections: [selection],
        defaultPlaneSelections: [],
        enginePrimitives: [],
        artifactGraph,
        engineCommandManager: world.engineCommandManager,
        kclManager: world.kclManager,
        wasmInstance: world.instance,
      })
      expect.soft(refs).toHaveLength(1)
      expect.soft(refs[0]?.code).not.toMatch(/\b(?:faceId|edgeId)\s*\(/)
      const note = await modelingCommandCodemods['GDT Annotation'].run({
        ast,
        kclManager: world.kclManager,
        wasmInstance: world.instance,
        args: {
          objects: { graphSelections: [selection], otherSelections: [] },
          annotation: 'generated edge',
          framePlane: 'XZ',
        },
      })
      if (isErr(note)) throw note
      const output = recast(note.modifiedAst, world.instance)
      if (isErr(output)) throw output
      expect(output).not.toMatch(/\b(?:faceId|edgeId)\s*\(/)
      sent.mockClear()
      await getAstAndArtifactGraph(output, world.instance, world.kclManager)
      expect(world.kclManager.errors, output).toEqual([])
      const actual = commands().find(
        (c) =>
          c.type === 'new_annotation' &&
          c.options.feature_control?.prefix === 'generated edge'
      )
      if (actual?.type !== 'new_annotation')
        throw new Error('Missing generated edge')
      const normalize = (
        e: typeof oracle.options.feature_control.edge_reference | undefined
      ) => ({
        ...e,
        side_faces: e?.side_faces.slice().sort(),
        end_faces: e?.end_faces?.slice().sort(),
      })
      expect(
        normalize(actual.options.feature_control?.edge_reference),
        output
      ).toEqual(normalize(oracle.options.feature_control.edge_reference))
    } finally {
      sent.mockRestore()
    }
  },
  60000
)
