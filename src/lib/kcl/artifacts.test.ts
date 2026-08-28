import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import { describe, expect, it } from 'vitest'
import {
  artifactKindFor,
  artifactsAtOffset,
  artifactsFrom,
  sourceRangeFor,
} from '@src/lib/kcl/artifacts'

const codeRef = (start: number, end: number) => ({
  range: [start, end, 0] as [number, number, number],
  nodePath: {} as never,
  pathToNode: [],
})

const graph = (entries: Record<string, unknown>) =>
  artifactsFrom({ map: entries })

describe('artifactsFrom', () => {
  it('reads the map kcl-lib serialises', () => {
    const artifacts = graph({
      a: { type: 'plane', id: 'a', pathIds: [], codeRef: codeRef(0, 10) },
    })

    expect(artifacts.size).toBe(1)
    expect(artifacts.get('a')?.type).toBe('plane')
  })

  it('drops the nulls the map can carry', () => {
    expect(graph({ a: null }).size).toBe(0)
  })

  /** A graph we cannot read means selection cannot name things, not a crash. */
  it('is empty for anything unexpected', () => {
    expect(artifactsFrom(undefined).size).toBe(0)
    expect(artifactsFrom(null).size).toBe(0)
    expect(artifactsFrom('nonsense').size).toBe(0)
    expect(artifactsFrom({}).size).toBe(0)
  })
})

describe('sourceRangeFor', () => {
  it('uses the artifact’s own code when it has some', () => {
    const artifacts = graph({
      seg: {
        type: 'segment',
        id: 'seg',
        pathId: 'p',
        codeRef: codeRef(40, 70),
      },
    })

    expect(sourceRangeFor(artifacts, 'seg')).toEqual([40, 70, 0])
  })

  /**
   * The case kcl-lib documents: a wall's own `codeRef` is the sketch-on-face
   * plane, so it has none of its own and the answer is the segment that drew it.
   */
  it('walks from a wall to the segment that drew it', () => {
    const artifacts = graph({
      wall: {
        type: 'wall',
        id: 'wall',
        segId: 'seg',
        sweepId: 'sweep',
        edgeCutEdgeIds: [],
        pathIds: [],
      },
      seg: {
        type: 'segment',
        id: 'seg',
        pathId: 'p',
        codeRef: codeRef(40, 70),
      },
      sweep: {
        type: 'sweep',
        id: 'sweep',
        subType: 'extrusion',
        pathId: 'p',
        surfaceIds: [],
        edgeIds: [],
        codeRef: codeRef(100, 130),
      },
    })

    // The line you would edit, not the extrude that raised it.
    expect(sourceRangeFor(artifacts, 'wall')).toEqual([40, 70, 0])
  })

  it('falls back to the sweep when there is no segment', () => {
    const artifacts = graph({
      cap: {
        type: 'cap',
        id: 'cap',
        subType: 'end',
        sweepId: 'sweep',
        edgeCutEdgeIds: [],
        pathIds: [],
      },
      sweep: {
        type: 'sweep',
        id: 'sweep',
        subType: 'extrusion',
        pathId: 'p',
        surfaceIds: [],
        edgeIds: [],
        codeRef: codeRef(100, 130),
      },
    })

    expect(sourceRangeFor(artifacts, 'cap')).toEqual([100, 130, 0])
  })

  /**
   * The graph has cycles — a wall names its sweep, a sweep names its surfaces —
   * so a naive walk does not return.
   */
  it('survives a cycle', () => {
    const artifacts = graph({
      wall: {
        type: 'wall',
        id: 'wall',
        segId: 'edge',
        sweepId: 'wall',
        edgeCutEdgeIds: [],
        pathIds: [],
      },
      edge: {
        type: 'sweepEdge',
        id: 'edge',
        subType: 'opposite',
        segId: 'wall',
        cmdId: '',
        sweepId: 'wall',
        commonSurfaceIds: [],
      },
    })

    expect(sourceRangeFor(artifacts, 'wall')).toBeNull()
  })

  it('has no answer for an entity it has never seen', () => {
    expect(sourceRangeFor(graph({}), 'nobody')).toBeNull()
  })
})

describe('looking the other way', () => {
  const artifacts = graph({
    sweep: {
      type: 'sweep',
      id: 'sweep',
      subType: 'extrusion',
      pathId: 'p',
      surfaceIds: [],
      edgeIds: [],
      codeRef: codeRef(0, 200),
    },
    seg: { type: 'segment', id: 'seg', pathId: 'p', codeRef: codeRef(40, 70) },
  })

  it('names the kind of thing an entity is', () => {
    expect(artifactKindFor(artifacts, 'seg')).toBe('segment')
    expect(artifactKindFor(artifacts, 'nobody')).toBeNull()
  })

  /** Narrowest first: a point inside both means the inner one. */
  it('finds what covers an offset, narrowest first', () => {
    const found = artifactsAtOffset(artifacts, 50)
    expect(found.map((entry) => entry.id)).toEqual(['seg', 'sweep'])
  })

  it('finds nothing outside every range', () => {
    expect(artifactsAtOffset(artifacts, 500)).toEqual([])
  })
})
