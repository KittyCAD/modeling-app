import { sketchBlockOnExtrudedFace } from '@src/lang/modifyAst/legacySketchFace'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
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
import {
  modelingMachineCommandConfig,
  type ModelingCommandSchema,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import { artifactToEntityRef } from '@src/lang/queryAst'
import { getSweepFromSuspectedSweepSurface } from '@src/lang/std/artifactGraph'
import { getCodeRefsFromEntityReference } from '@src/lib/selections'
import { isArray } from '@src/lib/utils'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'
import { isErr } from '@src/lib/trap'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'

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

afterEach(() => vi.restoreAllMocks())

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

async function validateGdtObjects(objects: Selections) {
  const config = modelingMachineCommandConfig['GDT Annotation']
  if (!config || isArray(config))
    throw new Error('Expected annotation command config')
  const argument = config.args?.objects
  if (argument?.inputType !== 'selection' || !argument.validation)
    throw new Error('Expected selection validation')
  return argument.validation({
    data: { objects },
    context: { argumentsToSubmit: {} } as CommandBarContext,
    machineContext: { kclManager: world.kclManager } as ModelingMachineContext,
  })
}

it.each(['fillet', 'chamfer'] as const)(
  'creates annotations and profiles from a feature-tree %s face',
  async (treatment) => {
    const code = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
profile = sketch(on = XY) {
  bottom = line(start = [0mm, 0mm], end = [10mm, 0mm])
  right = line(start = [10mm, 0mm], end = [10mm, 10mm])
  top = line(start = [10mm, 10mm], end = [0mm, 10mm])
  left = line(start = [0mm, 10mm], end = [0mm, 0mm])
}
box = region(point = [5mm, 5mm], sketch = profile)
extrude001 = extrude(box, length = 10mm, tagEnd = $capEnd001)
${treatment}001 = ${treatment}(
  extrude001,
  ${treatment === 'fillet' ? 'radius' : 'length'} = 1mm,
  edges = [{ sideFaces = [extrude001.sketch.tags.bottom, extrude001.faces.capEnd001] }],
)`
    const { ast, artifactGraph } = await getAstAndArtifactGraph(
      code,
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors).toEqual([])
    removeObsoleteEdges(artifactGraph)
    const cut = [...artifactGraph.values()].find(
      (artifact) => artifact.type === 'edgeCut'
    )
    if (cut?.type !== 'edgeCut') throw new Error('Expected treatment face')
    const entityRef = artifactToEntityRef(cut.type, cut.id)
    expect(entityRef).toEqual({ type: 'face', face_id: cut.id })
    if (!entityRef) throw new Error('Expected face reference')
    expect(
      getCodeRefsFromEntityReference(entityRef, artifactGraph)
    ).toContainEqual(cut.codeRef)
    const objects: Selections = {
      graphSelections: [{ artifact: cut, codeRef: cut.codeRef, entityRef }],
      otherSelections: [],
    }
    expect(await validateGdtObjects(objects)).toBe(true)
    const tolerance = await stringToKclExpression('0.1mm', world.rustContext)
    if (isErr(tolerance) || 'errors' in tolerance)
      throw new Error('Invalid tolerance')
    for (const kind of ['annotation', 'profile'] as const) {
      const context = {
        ast,
        kclManager: world.kclManager,
        wasmInstance: world.instance,
      }
      const result =
        kind === 'annotation'
          ? await modelingCommandCodemods['GDT Annotation'].run({
              ...context,
              args: { objects, annotation: 'Treatment face', framePlane: 'XZ' },
            })
          : await modelingCommandCodemods['GDT Profile'].run({
              ...context,
              args: { objects, tolerance, framePlane: 'XZ' },
            })
      if (isErr(result)) throw result
      const output = recast(result.modifiedAst, world.instance)
      if (isErr(output)) throw output
      expect(output).toContain(
        kind === 'annotation' ? 'gdt::annotation(' : 'gdt::profileSurface('
      )
      expect(output).toContain('faces = [')
      await getAstAndArtifactGraph(output, world.instance, world.kclManager)
      expect(world.kclManager.errors).toEqual([])
    }
  },
  60_000
)

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
    expect(await validateGdtObjects(selection)).toBe(
      'Sketch segments cannot be used as solid-edge selections.'
    )
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

it.each(['before', 'after'] as const)(
  'preserves recoverable edge bounds and index when an untracked edge comes %s',
  (position) => {
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
    const untrackedEdge = {
      type: 'Object' as const,
      value: {
        sideFaces: {
          type: 'Array' as const,
          value: ['untracked-a', 'untracked-b'].map((value) => ({
            type: 'Uuid' as const,
            value,
          })),
        },
      },
    }
    const selections = retrieveEdgeSelectionsFromOpArg(
      {
        sourceRange: [0, 0, 0],
        value: {
          type: 'Array',
          value: [
            ...(position === 'before' ? [untrackedEdge] : []),
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
            ...(position === 'after' ? [untrackedEdge] : []),
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
  }
)

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
    const body = getSweepFromSuspectedSweepSurface(cut.id, artifactGraph)
    if (isErr(body)) throw body
    if (body.type !== 'sweep') throw new Error('Expected sweep body')
    expect(body.surfaceIds).toContain(cut.id)
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

it('translates a treatment body without selecting a nested sketch segment', async () => {
  const code =
    chainedTreatmentCode +
    `sketch001 = sketch(on = faceOf(chamfer001, face = chamferFace01)) {
  circle1 = circle(start = [var 1.3mm, var 11.17mm], center = [var 4.43mm, var 8.34mm])
}`
  const { ast, artifactGraph } = await getAstAndArtifactGraph(
    code,
    world.instance,
    world.kclManager
  )
  expect(world.kclManager.errors).toEqual([])
  const cut = [...artifactGraph.values()].find(
    (a) => a.type === 'edgeCut' && a.subType === 'fillet'
  )
  if (cut?.type !== 'edgeCut') throw new Error('Fillet not found')
  const sweep = getSweepFromSuspectedSweepSurface(cut.id, artifactGraph)
  if (isErr(sweep)) throw sweep
  const x = await stringToKclExpression('5mm', world.rustContext)
  if (isErr(x) || 'errors' in x) throw new Error('Invalid distance')
  const result = await modelingCommandCodemods.Translate.run({
    ast,
    kclManager: world.kclManager,
    wasmInstance: world.instance,
    args: {
      objects: {
        graphSelections: [
          {
            entityRef: { type: 'solid3d', solid3d_id: sweep.id },
            codeRef: cut.codeRef,
          },
        ],
        otherSelections: [],
      },
      x,
    },
  })
  if (isErr(result)) throw result
  const output = recast(result.modifiedAst, world.instance)
  if (isErr(output)) throw output
  expect(output).toContain('translate(fillet001, x = 5mm)')
  await getAstAndArtifactGraph(output, world.instance, world.kclManager)
  expect(world.kclManager.errors).toEqual([])
}, 60_000)

it.each(['chamfer', 'fillet'])(
  'references the exact copied %s face in annotations',
  async (treatment) => {
    const code =
      chainedTreatmentCode +
      'copy = clone(fillet001) |> translate(x = 50mm, global = true)'
    const { ast, artifactGraph } = await getAstAndArtifactGraph(
      code,
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors).toEqual([])
    const cut = [...artifactGraph.values()].find(
      (a) =>
        a.type === 'edgeCut' && a.subType === treatment && a.sourceEdgeCutId
    )
    if (cut?.type !== 'edgeCut')
      throw new Error('Copied treatment face not found')
    const selection: Selection = {
      artifact: cut,
      codeRef: cut.codeRef,
      entityRef: { type: 'face', face_id: cut.id },
    }
    const result = await modelingCommandCodemods['GDT Annotation'].run({
      ast,
      kclManager: world.kclManager,
      wasmInstance: world.instance,
      args: {
        objects: { graphSelections: [selection], otherSelections: [] },
        annotation: 'Copied face',
        framePlane: 'XZ',
      },
    })
    if (isErr(result)) throw result
    const output = recast(result.modifiedAst, world.instance)
    if (isErr(output)) throw output
    expect(output).toContain(`copy.faces.${treatment}Face01`)
    const sent = vi.spyOn(world.engineCommandManager, 'sendCommand')
    await getAstAndArtifactGraph(
      output +
        `\ngdt::annotation(faces = [fillet001.faces.${treatment}Face01], annotation = "Original after copy", framePlane = XZ)`,
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors).toEqual([])
    const commands = sent.mock.calls.flatMap(([, message]) =>
      message.command.type === 'modeling_cmd_req'
        ? [message.command.cmd]
        : message.command.type === 'modeling_cmd_batch_req'
          ? message.command.requests.map((request) => request.cmd)
          : []
    )
    expect(commands).toContainEqual(
      expect.objectContaining({
        type: 'new_annotation',
        options: expect.objectContaining({
          feature_control: expect.objectContaining({ entity_id: cut.id }),
        }),
      })
    )
    expect(commands).toContainEqual(
      expect.objectContaining({
        type: 'new_annotation',
        options: expect.objectContaining({
          feature_control: expect.objectContaining({
            entity_id: cut.sourceEdgeCutId,
          }),
        }),
      })
    )
    const unsupportedCut = structuredClone(cut)
    delete unsupportedCut.sourceEdgeCutId
    expect(
      sketchBlockOnExtrudedFace(
        ast,
        { ...selection, artifact: unsupportedCut },
        cut.codeRef.pathToNode,
        cut.codeRef.pathToNode,
        artifactGraph,
        world.instance
      )
    ).toEqual(
      new Error('Cannot create a sketch on this copied treatment face.')
    )
    if (treatment !== 'chamfer') return
    const sketch = sketchBlockOnExtrudedFace(
      ast,
      selection,
      cut.codeRef.pathToNode,
      cut.codeRef.pathToNode,
      artifactGraph,
      world.instance
    )
    if (isErr(sketch)) throw sketch
    const sketchCode = recast(sketch.modifiedAst, world.instance)
    if (isErr(sketchCode)) throw sketchCode
    expect(sketchCode).toContain(
      'faceOf(copy, face = copy.faces.chamferFace01)'
    )
    await getAstAndArtifactGraph(
      sketchCode.replace(
        /(sketch\d+ = sketch\(on = faceOf[^\n]+\) \{)\n/,
        '$1\n  circle(start = [0.1mm, 0mm], center = [0mm, 0mm])\n'
      ),
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors).toEqual([])
    expect(world.kclManager.variables.sketch001).toMatchObject({
      type: 'Object',
      value: { meta: { value: { sketch: { value: { on: { id: cut.id } } } } } },
    })
  },
  60_000
)

it('sketches on the treatment face of the Boolean output body', async () => {
  const code = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
plateSketch = sketch(on = XY) {
  bottom = line(start = [0mm, 0mm], end = [20mm, 0mm])
  right = line(start = [20mm, 0mm], end = [20mm, 20mm])
  top = line(start = [20mm, 20mm], end = [0mm, 20mm])
  left = line(start = [0mm, 20mm], end = [0mm, 0mm])
}
plate = extrude(region(point = [10mm, 10mm], sketch = plateSketch), length = 5mm, tagEnd = $plateTop)
holeSketch = sketch(on = XY) {
  circle(start = [13mm, 10mm], center = [10mm, 10mm])
}
hole = extrude(region(point = [10mm, 10mm], sketch = holeSketch), length = 20mm, symmetric = true)
plateWithHole = subtract(plate, tools = hole)
chamfer001 = chamfer(plateWithHole, length = 1mm, edges = [{ sideFaces = [plate.sketch.tags.bottom, plateWithHole.faces.plateTop] }])
`
  const { ast, artifactGraph } = await getAstAndArtifactGraph(
    code,
    world.instance,
    world.kclManager
  )
  expect(world.kclManager.errors).toEqual([])
  const cut = [...artifactGraph.values()].find((a) => a.type === 'edgeCut')
  if (cut?.type !== 'edgeCut') throw new Error('Missing Boolean treatment face')
  const body = getSweepFromSuspectedSweepSurface(cut.id, artifactGraph)
  if (isErr(body)) throw body
  expect(body.type).toBe('compositeSolid')
  expect(cut.bodyId).toBe(body.id)
  const result = sketchBlockOnExtrudedFace(
    ast,
    {
      artifact: cut,
      codeRef: cut.codeRef,
      entityRef: { type: 'face', face_id: cut.id },
    },
    cut.codeRef.pathToNode,
    body.codeRef.pathToNode,
    artifactGraph,
    world.instance
  )
  if (isErr(result)) throw result
  const output = recast(result.modifiedAst, world.instance)
  if (isErr(output)) throw output
  expect(output).toContain('faceOf(chamfer001, face = ')
  await getAstAndArtifactGraph(
    output.replace(
      /(sketch\d+ = sketch\(on = faceOf[^\n]+\) \{)\n/,
      '$1\n  circle(start = [0.1mm, 0mm], center = [0mm, 0mm])\n'
    ),
    world.instance,
    world.kclManager
  )
  expect(world.kclManager.errors).toEqual([])
  expect(world.kclManager.variables.sketch001).toMatchObject({
    type: 'Object',
    value: { meta: { value: { sketch: { value: { on: { id: cut.id } } } } } },
  })
}, 60_000)

it.each([
  { operation: 'mirror3d(fillet001, across = YZ)', body: 'copy' },
  {
    operation:
      'patternLinear3d(fillet001, instances = 3, distance = 50mm, axis = X)',
    body: 'copy[1]',
  },
  {
    operation:
      'patternCircular3d(fillet001, instances = 3, axis = Z, center = [0mm, 0mm, 0mm], arcDegrees = 360deg)',
    body: 'copy[1]',
  },
])(
  'preserves treatment instance identity for $operation',
  async ({ operation, body }) => {
    const code =
      chainedTreatmentCode +
      `copy = ${operation}
sketchOnCopy = sketch(on = faceOf(${body}, face = ${body}.faces.chamferFace01)) {
  circle(start = [0.1mm, 0mm], center = [0mm, 0mm])
}
gdt::annotation(faces = [${body}.faces.chamferFace01], annotation = "Copied chamfer", framePlane = XZ)
gdt::annotation(faces = [${body}.faces.filletFace01], annotation = "Copied fillet", framePlane = XZ)
gdt::annotation(faces = [chamferFace01], annotation = "Bare tag after copy", framePlane = XZ)
`
    const sent = vi.spyOn(world.engineCommandManager, 'sendCommand')
    const { artifactGraph } = await getAstAndArtifactGraph(
      code,
      world.instance,
      world.kclManager
    )
    expect(world.kclManager.errors).toEqual([])
    const owner = [...artifactGraph.values()].find(
      (a) =>
        (a.type === 'pattern' || a.type === 'sweep') &&
        code
          .slice(a.codeRef.range[0], a.codeRef.range[1])
          .includes(operation.split('(')[0])
    )
    if (owner?.type !== 'sweep' && owner?.type !== 'pattern')
      throw new Error('Missing copied body')
    const original = [...artifactGraph.values()].find(
      (a) => a.type === 'edgeCut' && a.subType === 'chamfer'
    )
    if (!original) throw new Error('Missing original chamfer')
    const commands = sent.mock.calls.flatMap(([, message]) =>
      message.command.type === 'modeling_cmd_req'
        ? [message.command.cmd]
        : message.command.type === 'modeling_cmd_batch_req'
          ? message.command.requests.map((request) => request.cmd)
          : []
    )
    expect(commands).toContainEqual(
      expect.objectContaining({
        type: 'new_annotation',
        options: expect.objectContaining({
          feature_control: expect.objectContaining({
            entity_id:
              owner.type === 'sweep'
                ? expect.toBeOneOf(owner.surfaceIds)
                : original.id,
            prefix: 'Bare tag after copy',
          }),
        }),
      })
    )
    const bodyId = owner.type === 'sweep' ? owner.id : owner.copyIds[0]
    const faceIds =
      owner.type === 'sweep' ? owner.surfaceIds : owner.copyFaceIds
    for (const prefix of ['Copied chamfer', 'Copied fillet']) {
      expect(commands).toContainEqual(
        expect.objectContaining({
          type: 'new_annotation',
          options: expect.objectContaining({
            feature_control: expect.objectContaining({
              entity_id: expect.toBeOneOf(faceIds),
              prefix,
            }),
          }),
        })
      )
    }

    expect(world.kclManager.variables.sketchOnCopy).toMatchObject({
      type: 'Object',
      value: {
        meta: {
          value: {
            sketch: {
              value: {
                on: {
                  type: 'face',
                  id: expect.toBeOneOf(faceIds),
                  value: 'chamferFace01',
                  parentSolid: { solidId: bodyId },
                },
              },
            },
          },
        },
      },
    })
  },
  60_000
)
