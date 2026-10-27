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

// TODO: Remove this pruning once PR4 removes obsolete edges from the graph producer.
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
  world = await buildTheWorldAndConnectToEngine({
    webrtc: false,
    geometryOnly: true,
  })
})
afterAll(() => {
  world?.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

// Neither extrusion direction makes a source segment an unambiguous solid edge.
it.each(
  [
    { command: 'Fillet' as const, length: 12 },
    { command: 'Fillet' as const, length: -12 },
    { command: 'Chamfer' as const, length: 12 },
    { command: 'Chamfer' as const, length: -12 },
    { command: 'GDT Straightness' as const, length: 12 },
    { command: 'GDT Straightness' as const, length: -12 },
  ].flatMap((example) =>
    ['legacy', 'sketch block'].map((sketch) => ({ ...example, sketch }))
  )
)(
  'rejects code-selected segments for $command with extrusion length $length ($sketch)',
  async ({ command, length, sketch }) => {
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
    const originalCode = recast(ast, world.instance)
    const send = vi.spyOn(world.engineCommandManager, 'sendSceneCommand')
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
    expect(send).not.toHaveBeenCalled()
    send.mockRestore()
    expect(result).toEqual(
      new Error('Sketch segments cannot be used as solid-edge selections.')
    )
    expect(recast(ast, world.instance)).toEqual(originalCode)
    expect(recast(world.kclManager.ast, world.instance)).toEqual(originalCode)
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

// Compatibility: editing an existing call must not revalidate or rebuild tags.
it.each(['Fillet', 'Chamfer'] as const)(
  'edits a legacy %s direct-tag call through its production wrapper',
  async (command) => {
    const parameter = command === 'Fillet' ? 'radius' : 'length'
    const functionName = command.toLowerCase()
    const code = `@settings(kclVersion = 2.0)
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5, tag = $seg01)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5)
${functionName}001 = ${functionName}(extrude001, tags = [seg01], ${parameter} = 1)`
    const { ast, artifactGraph, operations } = await getAstAndArtifactGraph(
      code,
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors).toEqual([])
    const operation = getAllOperations(operations).find(
      (op) => op.type === 'StdLibCall' && op.name === functionName
    )
    if (!operation) throw new Error('Treatment operation not found')
    const edit = await enterEditFlow({
      operation,
      code,
      artifactGraph,
      rustContext: world.rustContext,
    })
    if (isErr(edit)) throw edit
    if (edit.type !== 'Find and select command')
      throw new Error('Expected edit command')
    const size = await stringToKclExpression('1.1', world.rustContext)
    if (isErr(size) || 'errors' in size) throw new Error('Could not parse size')
    const defaults = edit.data
      .argDefaultValues as ModelingCommandSchema['Fillet']
    expect(defaults.nodeToEdit).toBeDefined()
    expect(defaults.selection.graphSelections[0].entityRef?.type).toBe(
      'segment'
    )
    const originalCode = recast(ast, world.instance)
    if (isErr(originalCode)) throw originalCode
    const context = {
      ast,
      kclManager: world.kclManager,
      wasmInstance: world.instance,
    }
    const result =
      command === 'Fillet'
        ? await modelingCommandCodemods.Fillet.run({
            ...context,
            args: { ...defaults, radius: size },
          })
        : await modelingCommandCodemods.Chamfer.run({
            ...context,
            args: {
              ...defaults,
              length: size,
            },
          })
    if (isErr(result)) throw result
    const output = recast(result.modifiedAst, world.instance)
    if (isErr(output)) throw output
    expect(output).toBe(
      originalCode.replace(`${parameter} = 1`, `${parameter} = 1.1`)
    )
    expect(recast(ast, world.instance)).toBe(originalCode)
    await getAstAndArtifactGraph(output, world.instance, world.kclManager)
    expect(world.kclManager.errors).toEqual([])
  },
  30_000
)

it.each(['fillet', 'chamfer'] as const)(
  'translates a real %s treatment selection after pruning obsolete graph data',
  async (treatment) => {
    const code = `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [24, 0])
  right = line(start = [24, 0], end = [24, 12])
  top = line(start = [24, 12], end = [0, 12])
  left = line(start = [0, 12], end = [0, 0])
}
region001 = region(point = [12, 6], sketch = sketch001)
extrude001 = extrude(region001, length = 12, tagEnd = $top)
${treatment}001 = ${treatment}(
  extrude001,
  edges = [{ sideFaces = [region001.tags.bottom, extrude001.faces.top] }],
  ${treatment === 'fillet' ? 'radius' : 'length'} = 1,
)
hide(sketch001)`
    const { ast, artifactGraph } = await getAstAndArtifactGraph(
      code,
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors).toEqual([])
    const cut = [...artifactGraph.values()].find(
      (a) => a.type === 'edgeCut' && a.subType === treatment
    )
    if (cut?.type !== 'edgeCut') throw new Error('Treatment artifact not found')
    removeObsoleteEdges(artifactGraph)
    const originalCode = recast(ast, world.instance)
    const x = await stringToKclExpression('5', world.rustContext)
    if (isErr(x) || 'errors' in x) throw new Error('Could not parse distance')
    const result = await modelingCommandCodemods.Translate.run({
      ast,
      kclManager: world.kclManager,
      wasmInstance: world.instance,
      args: {
        objects: {
          graphSelections: [{ artifact: cut, codeRef: cut.codeRef }],
          otherSelections: [],
        },
        x,
      },
    })
    if (isErr(result)) throw result
    const output = recast(result.modifiedAst, world.instance)
    if (isErr(output)) throw output
    expect(output).toContain(`translate(${treatment}001, x = 5)`)
    expect(recast(ast, world.instance)).toBe(originalCode)
    await getAstAndArtifactGraph(output, world.instance, world.kclManager)
    expect(world.kclManager.errors).toEqual([])
  },
  30_000
)

it.each(['Fillet', 'Chamfer', 'GDT Straightness'] as const)(
  'creates %s from a complete viewport edge through its production wrapper',
  async (command) => {
    const code = `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [24, 0])
  right = line(start = [24, 0], end = [24, 12])
  top = line(start = [24, 12], end = [0, 12])
  left = line(start = [0, 12], end = [0, 0])
}
region001 = region(point = [12, 6], sketch = sketch001)
extrude001 = extrude(region001, length = 12)
hide(sketch001)`
    const { ast, artifactGraph } = await getAstAndArtifactGraph(
      code,
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors).toEqual([])
    const wall = [...artifactGraph.values()].find((a) => a.type === 'wall')
    const cap = [...artifactGraph.values()].find(
      (a) => a.type === 'cap' && a.subType === 'end'
    )
    if (wall?.type !== 'wall' || cap?.type !== 'cap')
      throw new Error('Source faces not found')
    const segment = artifactGraph.get(wall.segId)
    if (segment?.type !== 'segment') throw new Error('Source segment not found')
    const selection: Selections = {
      graphSelections: [
        {
          codeRef: segment.codeRef,
          entityRef: {
            type: 'edge',
            side_faces: [wall.id, cap.id],
          },
        },
      ],
      otherSelections: [],
    }
    removeObsoleteEdges(artifactGraph)
    const originalCode = recast(ast, world.instance)
    const size = await stringToKclExpression('1', world.rustContext)
    if (isErr(size) || 'errors' in size) throw new Error('Could not parse size')
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
              args: {
                objects: selection,
                tolerance: size,
                framePlane: 'XZ',
              },
            })
    if (isErr(result)) throw result
    const output = recast(result.modifiedAst, world.instance)
    if (isErr(output)) throw output
    expect(output).toContain(
      command === 'GDT Straightness'
        ? 'gdt::straightness('
        : `${command.toLowerCase()}(`
    )
    expect(output).toContain('sideFaces')
    expect(recast(ast, world.instance)).toBe(originalCode)
    await getAstAndArtifactGraph(output, world.instance, world.kclManager)
    expect(world.kclManager.errors).toEqual([])
  },
  30_000
)
