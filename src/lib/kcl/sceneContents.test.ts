import { describe, expect, it } from 'vitest'
import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'
import { hiddenClosure, sceneIsEmpty } from '@src/lib/kcl/sceneContents'

const graph = (...artifacts: Artifact[]): ArtifactMap =>
  new Map(artifacts.map((artifact) => [artifact.id, artifact]))

const at = (id: string, body: Record<string, unknown>) =>
  ({ id, ...body }) as unknown as Artifact

const path = (id: string, options: { consumed?: boolean } = {}) =>
  at(id, {
    type: 'path',
    planeId: 'plane1',
    segIds: [],
    consumed: options.consumed ?? false,
  })

const sweep = (id: string, parts: string[] = []) =>
  at(id, {
    type: 'sweep',
    pathId: 'path1',
    surfaceIds: parts,
    edgeIds: [],
    consumed: false,
  })

const wall = (id: string, sweepId: string) =>
  at(id, { type: 'wall', segId: 's', sweepId, edgeCutEdgeIds: [], pathIds: [] })

describe('whether the scene has anything in it', () => {
  it('is empty before anything has run', () => {
    expect(sceneIsEmpty(graph())).toBe(true)
  })

  it('is not empty once something draws', () => {
    expect(sceneIsEmpty(graph(path('path1')))).toBe(false)
  })

  /*
   * The existing app counts `artifactGraph.size`, which calls these populated. A
   * saved camera and the surface a sketch was started on put nothing on screen.
   */
  it('ignores the artifacts that draw nothing', () => {
    const bookkeeping = graph(
      at('plane1', { type: 'plane', pathIds: [], codeRef: {} }),
      at('view1', { type: 'namedView', codeRef: {} }),
      at('block1', { type: 'sketchBlock', codeRef: {} }),
      at('start1', { type: 'startSketchOnPlane', planeId: 'plane1' })
    )

    expect(sceneIsEmpty(bookkeeping)).toBe(true)
  })

  /*
   * The case the existing app gets wrong: a file whose only solid is hidden
   * renders an empty scene, and should get its planes back.
   */
  it('is empty again when everything is hidden', () => {
    const scene = graph(sweep('sweep1'), path('path1', { consumed: true }))

    expect(sceneIsEmpty(scene)).toBe(false)
    expect(sceneIsEmpty(scene, new Set(['sweep1']))).toBe(true)
  })

  /*
   * `hide(body001)` names the sweep, and the walls that make it up are separate
   * artifacts that go with it — otherwise hiding a body would leave its faces
   * behind as evidence that something is still there.
   */
  it('takes a hidden body’s parts with it', () => {
    const scene = graph(
      sweep('sweep1', ['wall1']),
      wall('wall1', 'sweep1'),
      path('path1', { consumed: true })
    )

    expect(sceneIsEmpty(scene, new Set(['sweep1']))).toBe(true)
  })

  it('follows a composite solid down to its constituents', () => {
    const scene = graph(
      at('comp1', {
        type: 'compositeSolid',
        subType: 'union',
        solidIds: ['sweep1'],
        toolIds: ['sweep2'],
        consumed: false,
        codeRef: {},
      }),
      sweep('sweep1'),
      sweep('sweep2')
    )

    expect(sceneIsEmpty(scene, new Set(['comp1']))).toBe(true)
  })

  it('leaves what was not hidden visible', () => {
    const scene = graph(sweep('sweep1'), sweep('sweep2'))

    expect(sceneIsEmpty(scene, new Set(['sweep1']))).toBe(false)
  })

  /*
   * A profile that has been swept is inside the solid it made rather than beside
   * it, so it must not keep the planes away on its own.
   */
  it('does not count geometry a later operation consumed', () => {
    expect(sceneIsEmpty(graph(path('path1', { consumed: true })))).toBe(true)
    expect(sceneIsEmpty(graph(path('path1', { consumed: false })))).toBe(false)
  })

  /*
   * A failed run still reports what it got done, so this needs no special case:
   * a program that errored after extruding is populated because the sweep is
   * there.
   */
  it('counts what a failed run managed to build', () => {
    expect(sceneIsEmpty(graph(sweep('sweep1')))).toBe(false)
  })
})

describe('what a hidden artifact takes with it', () => {
  it('keeps going through nested parts', () => {
    const scene = graph(
      at('comp1', {
        type: 'compositeSolid',
        subType: 'union',
        solidIds: ['sweep1'],
        toolIds: [],
        consumed: false,
        codeRef: {},
      }),
      sweep('sweep1', ['wall1']),
      wall('wall1', 'sweep1')
    )

    expect([...hiddenClosure(scene, new Set(['comp1']))].sort()).toEqual([
      'comp1',
      'sweep1',
      'wall1',
    ])
  })

  /* A graph that points at itself is a normal thing to be handed after a failure. */
  it('terminates on a graph that loops', () => {
    const scene = graph(
      sweep('sweep1', ['sweep2']),
      sweep('sweep2', ['sweep1'])
    )

    expect(hiddenClosure(scene, new Set(['sweep1'])).size).toBe(2)
  })

  it('ignores an id the graph has never heard of', () => {
    expect([...hiddenClosure(graph(), new Set(['gone']))]).toEqual(['gone'])
  })
})
