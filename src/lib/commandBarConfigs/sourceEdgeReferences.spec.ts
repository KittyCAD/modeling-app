import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { getAstAndArtifactGraph } from '@src/lib/testHelpers'
import {
  recast,
  getAllOperations,
  type Artifact,
  type ArtifactGraph,
} from '@src/lang/wasm'
import { retrieveEdgeSelectionsFromOpArg } from '@src/lang/modifyAst/edges'
import { enterEditFlow } from '@src/lib/operations'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import { isErr } from '@src/lib/trap'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type { Selections } from '@src/machines/modelingSharedTypes'

function removeObsoleteEdges(graph: ArtifactGraph) {
  for (const [id, artifact] of graph) {
    if (artifact.type === 'sweepEdge' || artifact.type === 'edgeCutEdge') {
      graph.delete(id)
      continue
    }
    for (const field of [
      'edgeIds',
      'commonSurfaceIds',
      'edgeCutEdgeIds',
      'consumedEdgeId',
    ]) {
      Reflect.deleteProperty(artifact, field)
    }
  }
}

let world: Awaited<ReturnType<typeof buildTheWorldAndConnectToEngine>>
beforeAll(async () => {
  world = await buildTheWorldAndConnectToEngine({ webrtc: false, pool: 'cpu' })
})
afterAll(() => {
  world?.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

// Legacy sketch compatibility: code selection must preserve the original physical edge.
it.each(
  [
    { command: 'Fillet' as const, length: 12, cap: 'capStart001' },
    { command: 'Fillet' as const, length: -12, cap: 'capEnd001' },
    { command: 'Chamfer' as const, length: 12, cap: 'capStart001' },
    { command: 'Chamfer' as const, length: -12, cap: 'capEnd001' },
    { command: 'GDT Straightness' as const, length: 12, cap: 'capStart001' },
    { command: 'GDT Straightness' as const, length: -12, cap: 'capEnd001' },
  ].flatMap((example) =>
    ['legacy', 'sketch block'].map((sketch) => ({ ...example, sketch }))
  )
)(
  'preserves the source edge for $command with extrusion length $length ($sketch)',
  async ({ command, length, cap, sketch }) => {
    const code =
      sketch === 'legacy'
        ? `@settings(kclVersion = 1.0)

sketch001 = startSketchOn(XY)
  |> startProfile(at = [-12, -6])
  |> line(end = [0, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -12])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = ${length})`
        : `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [24, 0])
  right = line(start = [24, 0], end = [24, 12])
  top = line(start = [24, 12], end = [0, 12])
  left = line(start = [0, 12], end = [0, 0])
}
region001 = region(point = [12, 6], sketch = sketch001)
extrude001 = extrude(region001, length = ${length})`
    const { ast, artifactGraph } = await getAstAndArtifactGraph(
      code,
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors).toEqual([])
    removeObsoleteEdges(artifactGraph)
    const segment = [...artifactGraph.values()].find(
      (a) =>
        a.type === 'segment' &&
        code
          .slice(a.codeRef.range[0], a.codeRef.range[1])
          .includes(sketch === 'legacy' ? 'endAbsolute' : 'start = [0, 12]')
    )
    if (segment?.type !== 'segment') throw new Error('Source segment not found')
    expect(
      [...artifactGraph.values()].some((a) => a.type === 'sweepEdge')
    ).toBe(false)
    const selection: Selections = {
      graphSelections: [{ artifact: segment, codeRef: segment.codeRef }],
      otherSelections: [],
    }
    const size = (await stringToKclExpression(
      '1',
      world.rustContext
    )) as KclCommandValue
    const context = {
      ast,
      kclManager: world.kclManager,
      wasmInstance: world.instance,
    }
    const result =
      command === 'Fillet'
        ? await modelingCommandCodemods.Fillet.run({
            ...context,
            args: { selection, radius: size },
          })
        : command === 'Chamfer'
          ? await modelingCommandCodemods.Chamfer.run({
              ...context,
              args: { selection, length: size },
            })
          : await modelingCommandCodemods['GDT Straightness'].run({
              ...context,
              args: { objects: selection, tolerance: size, framePlane: 'XZ' },
            })
    if (isErr(result)) throw result
    const output = recast(result.modifiedAst, world.instance)
    if (isErr(output)) throw output
    expect(output).toContain(
      command === 'GDT Straightness' ? cap : `extrude001.faces.${cap}`
    )
    expect(output).toContain('sideFaces')
    expect(output).not.toContain(
      cap === 'capEnd001' ? 'capStart001' : 'capEnd001'
    )
    if (command === 'Fillet' && length < 0 && sketch === 'legacy') {
      const manager = world.engineCommandManager
      const send = manager.sendSceneCommand.bind(manager)
      const spy = vi
        .spyOn(manager, 'sendSceneCommand')
        .mockImplementation(async (...args) => {
          const response = await send(...args)
          world.kclManager.ast = structuredClone(world.kclManager.ast)
          return response
        })
      try {
        const staleResult = await modelingCommandCodemods.Fillet.run({
          ...context,
          args: { selection, radius: size },
        })
        expect(staleResult).toEqual(
          new Error(
            'The model changed while resolving the selected edge. Please select it again.'
          )
        )
      } finally {
        spy.mockRestore()
      }
    }
    await getAstAndArtifactGraph(output, world.instance, world.kclManager)
    expect(world.kclManager.errors).toEqual([])
  },
  30_000
)

it.each(['circularity', 'cylindricity'] as const)(
  'edits %s annotations with face and edge targets after graph edge data is removed',
  async (annotation) => {
    for (const target of ['faces', 'edges']) {
      const code = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
cylinderSketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}
cylinderRegion = region(point = cylinderSketch.perimeter.center, sketch = cylinderSketch)
cylinder = extrude(cylinderRegion, length = 10mm, tagEnd = $top)
hide(cylinderSketch)
gdt::${annotation}(
  ${target} = [${target === 'faces' ? 'cylinder.sketch.tags.perimeter' : '{ sideFaces = [cylinder.sketch.tags.perimeter, cylinder.faces.top] }'}],
  tolerance = 0.05mm,
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)`
      const { ast, artifactGraph, operations } = await getAstAndArtifactGraph(
        code,
        world.instance,
        world.kclManager
      )
      expect(world.kclManager.errors).toEqual([])
      removeObsoleteEdges(artifactGraph)
      const operation = getAllOperations(operations).find(
        (op) => op.type === 'StdLibCall' && op.name === `gdt::${annotation}`
      )
      if (!operation) throw new Error('Annotation operation not found')
      const edit = await enterEditFlow({
        operation,
        code,
        artifactGraph,
        rustContext: world.rustContext,
      })
      if (isErr(edit)) throw edit
      if (edit.type !== 'Find and select command')
        throw new Error('Expected edit command')
      expect(edit.data.name).toBe(
        annotation === 'circularity' ? 'GDT Circularity' : 'GDT Cylindricity'
      )
      const defaults = edit.data
        .argDefaultValues as ModelingCommandSchema['GDT Circularity']
      expect(defaults.objects.graphSelections).toHaveLength(1)
      if (target === 'edges')
        expect(defaults.objects.graphSelections[0].entityRef?.type).toBe('edge')
      const tolerance = await stringToKclExpression('0.1mm', world.rustContext)
      if (isErr(tolerance) || 'errors' in tolerance)
        throw new Error('Could not parse tolerance')
      const context = {
        ast,
        kclManager: world.kclManager,
        wasmInstance: world.instance,
        args: { ...defaults, tolerance },
      }
      const result =
        annotation === 'circularity'
          ? await modelingCommandCodemods['GDT Circularity'].run(context)
          : await modelingCommandCodemods['GDT Cylindricity'].run(context)
      if (isErr(result)) throw result
      const output = recast(result.modifiedAst, world.instance)
      if (isErr(output)) throw output
      expect(output).toContain(`gdt::${annotation}(`)
      expect(output).toContain('tolerance = 0.1mm')
      expect(output).toContain(`${target} = [`)
      await getAstAndArtifactGraph(output, world.instance, world.kclManager)
      expect(world.kclManager.errors).toEqual([])
    }
  },
  30_000
)

it('blends sketch-block surface edges without adjacency artifacts', async () => {
  const code = `@settings(kclVersion = 3.0, experimentalFeatures = allow)
sketch001 = sketch(on = XY) {
  line1 = line(start = [var -9.76mm, var 1.02mm], end = [var -4.06mm, var 5.49mm])
}
extrude001 = extrude(sketch001.line1, length = 5, bodyType = SURFACE)
sketch002 = sketch(on = XY) {
  line1 = line(start = [var -13.52mm, var 5.92mm], end = [var -6.48mm, var 9.82mm])
}
extrude002 = extrude(sketch002.line1, length = 5, bodyType = SURFACE)
hide(sketch001)
hide(sketch002)`
  const { ast, artifactGraph } = await getAstAndArtifactGraph(
    code,
    world.instance,
    world.kclManager
  )
  expect(world.kclManager.errors).toEqual([])
  removeObsoleteEdges(artifactGraph)
  const segments = [...artifactGraph.values()].filter(
    (artifact): artifact is Extract<Artifact, { type: 'segment' }> =>
      artifact.type === 'segment' && Boolean(artifact.surfaceId)
  )
  expect(segments).toHaveLength(2)
  const result = await modelingCommandCodemods.Blend.run({
    ast,
    kclManager: world.kclManager,
    wasmInstance: world.instance,
    args: {
      edges: {
        graphSelections: segments.map((artifact) => ({
          artifact,
          codeRef: artifact.codeRef,
        })),
        otherSelections: [],
      },
    },
  })
  if (isErr(result)) throw result
  const output = recast(result.modifiedAst, world.instance)
  if (isErr(output)) throw output
  expect(output).toContain('blend(')
  expect(output).toContain('getBoundedEdge(')
  await getAstAndArtifactGraph(output, world.instance, world.kclManager)
  expect(world.kclManager.errors).toEqual([])
}, 30_000)

it('preserves single-face edge bounds and index when recovering edit selections', () => {
  const codeRef = {
    range: [0, 0, 0] as [number, number, number],
    pathToNode: [],
    nodePath: { steps: [] },
  }
  const graph: ArtifactGraph = new Map([
    [
      'segment',
      {
        type: 'segment',
        id: 'segment',
        pathId: 'path',
        edgeIds: [],
        commonSurfaceIds: [],
        codeRef,
      },
    ],
  ])
  removeObsoleteEdges(graph)
  const selections = retrieveEdgeSelectionsFromOpArg(
    {
      sourceRange: [0, 0, 0],
      value: {
        type: 'Array',
        value: [
          {
            type: 'Object',
            value: {
              sideFaces: {
                type: 'Array',
                value: [{ type: 'Uuid', value: 'segment' }],
              },
              endFaces: {
                type: 'Array',
                value: [
                  { type: 'Uuid', value: 'bound-a' },
                  { type: 'Uuid', value: 'bound-b' },
                ],
              },
              index: { type: 'Number', value: 2, ty: { type: 'Any' } },
            },
          },
        ],
      },
    },
    graph
  )
  if (isErr(selections)) throw selections
  expect(selections.graphSelections).toEqual([
    {
      codeRef,
      entityRef: {
        type: 'edge',
        side_faces: ['segment'],
        end_faces: ['bound-a', 'bound-b'],
        index: 2,
      },
    },
  ])
})
