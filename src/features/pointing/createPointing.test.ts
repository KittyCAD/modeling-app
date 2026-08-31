import { signal } from '@preact/signals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type ArtifactMap, artifactsFrom } from '@src/lib/kcl/artifacts'
import { createPointing } from '@src/features/pointing/createPointing'

const codeRef = (start: number, end: number) => ({
  range: [start, end, 0] as [number, number, number],
  nodePath: {} as never,
  pathToNode: [],
})

/** One sketched line, extruded into a wall and a cap. */
const artifacts = artifactsFrom({
  map: {
    path: {
      type: 'path',
      id: 'path',
      subType: 'sketch',
      planeId: 'plane',
      segIds: ['seg'],
      consumed: true,
      sweepId: 'sweep',
      codeRef: codeRef(0, 99),
    },
    seg: {
      type: 'segment',
      id: 'seg',
      pathId: 'path',
      edgeIds: [],
      surfaceId: 'wall',
      commonSurfaceIds: [],
      codeRef: codeRef(30, 60),
    },
    sweep: {
      type: 'sweep',
      id: 'sweep',
      subType: 'extrusion',
      pathId: 'path',
      surfaceIds: ['wall', 'cap'],
      edgeIds: [],
      trajectoryId: null,
      codeRef: codeRef(160, 220),
    },
    wall: {
      type: 'wall',
      id: 'wall',
      segId: 'seg',
      sweepId: 'sweep',
      edgeCutEdgeIds: [],
      pathIds: [],
      faceCodeRef: codeRef(0, 0),
      cmdId: 'c1',
    },
    cap: {
      type: 'cap',
      id: 'cap',
      subType: 'end',
      sweepId: 'sweep',
      edgeCutEdgeIds: [],
      pathIds: [],
      faceCodeRef: codeRef(0, 0),
      cmdId: 'c2',
    },
  },
})

let dispose: (() => void) | null = null

afterEach(() => {
  dispose?.()
  dispose = null
})

const setup = (options: { graph?: ArtifactMap } = {}) => {
  const highlight = vi.fn<(ids: readonly string[]) => void>()
  const graph = signal(options.graph ?? artifacts)

  const pointing = createPointing({
    artifacts: graph,
    highlighter: () => ({ highlight }),
  })
  pointing.start()
  dispose = pointing.dispose

  return { pointing, graph, highlight }
}

describe('pointing at the scene', () => {
  it('answers with the code responsible', () => {
    const app = setup()

    app.pointing.point({ at: { kind: 'entity', id: 'wall' }, from: 'scene' })

    expect(app.pointing.provenance.value?.ranges).toEqual([
      { range: [160, 220, 0], role: 'primary' },
      { range: [30, 60, 0], role: 'origin' },
    ])
  })

  /*
   * The engine lit the thing under the pointer as it answered the pick. Sending
   * a set of ids on top would be two things arguing over one highlight.
   */
  it('does not tell the renderer what it already knows', () => {
    const app = setup()

    app.pointing.point({ at: { kind: 'entity', id: 'wall' }, from: 'scene' })

    expect(app.highlight).not.toHaveBeenCalled()
  })
})

describe('pointing at the code', () => {
  it('lights everything the call made', () => {
    const app = setup()

    app.pointing.point({ at: { kind: 'offset', offset: 190 }, from: 'code' })

    expect(app.highlight).toHaveBeenLastCalledWith(['sweep', 'wall', 'cap'])
  })

  it('decorates the call itself, since the caller only had an offset', () => {
    const app = setup()

    app.pointing.point({ at: { kind: 'offset', offset: 190 }, from: 'code' })

    expect(app.pointing.provenance.value?.ranges[0]).toEqual({
      range: [160, 220, 0],
      role: 'primary',
    })
  })

  it('takes the highlight away when the pointer leaves', () => {
    const app = setup()
    app.pointing.point({ at: { kind: 'offset', offset: 190 }, from: 'code' })

    app.pointing.clear('code')

    expect(app.highlight).toHaveBeenLastCalledWith([])
  })

  /*
   * Once, and then never again while the scene is doing its own hovering — the
   * code-driven highlight has to come off exactly one time, and repeating it
   * would keep wiping the engine's hover as the pointer moves.
   */
  it('clears the code highlight once when the pointer moves to the scene', () => {
    const app = setup()
    app.pointing.point({ at: { kind: 'offset', offset: 190 }, from: 'code' })
    app.highlight.mockClear()

    app.pointing.point({ at: { kind: 'entity', id: 'wall' }, from: 'scene' })
    app.pointing.point({ at: { kind: 'entity', id: 'cap' }, from: 'scene' })

    expect(app.highlight.mock.calls).toEqual([[[]]])
  })
})

describe('who is allowed to stop pointing', () => {
  /*
   * The pointer leaving the editor says nothing about a hover the scene is still
   * showing, and an unscoped clear would have the two stamp on each other every
   * time the mouse crossed between them.
   */
  it('ignores a clear from a surface that is not pointing', () => {
    const app = setup()
    app.pointing.point({ at: { kind: 'entity', id: 'wall' }, from: 'scene' })

    app.pointing.clear('code')

    expect(app.pointing.pointing.value).not.toBeNull()
  })

  it('clears when it is that surface pointing', () => {
    const app = setup()
    app.pointing.point({ at: { kind: 'entity', id: 'wall' }, from: 'scene' })

    app.pointing.clear('scene')

    expect(app.pointing.pointing.value).toBeNull()
    expect(app.pointing.provenance.value).toBeNull()
  })
})

/*
 * Not an optimisation. A pointermove fires per pixel and the answer changes per
 * expression, so a consumer that dispatched an editor transaction per change
 * would dispatch one per pixel of mouse travel.
 */
describe('keeping still while the pointer moves', () => {
  it('returns the same answer object across a call', () => {
    const app = setup()

    app.pointing.point({ at: { kind: 'offset', offset: 170 }, from: 'code' })
    const first = app.pointing.provenance.value

    app.pointing.point({ at: { kind: 'offset', offset: 190 }, from: 'code' })

    expect(app.pointing.provenance.value).toBe(first)
  })

  it('answers afresh once the pointer reaches something else', () => {
    const app = setup()

    app.pointing.point({ at: { kind: 'offset', offset: 190 }, from: 'code' })
    const first = app.pointing.provenance.value

    app.pointing.point({ at: { kind: 'offset', offset: 45 }, from: 'code' })

    expect(app.pointing.provenance.value).not.toBe(first)
  })

  it('says nothing to the renderer while the answer holds', () => {
    const app = setup()
    app.pointing.point({ at: { kind: 'offset', offset: 170 }, from: 'code' })
    app.highlight.mockClear()

    app.pointing.point({ at: { kind: 'offset', offset: 190 }, from: 'code' })

    expect(app.highlight).not.toHaveBeenCalled()
  })
})

describe('before there is a graph', () => {
  it('says the graph has never heard of it', () => {
    const app = setup({ graph: new Map() })

    app.pointing.point({ at: { kind: 'entity', id: 'wall' }, from: 'scene' })

    expect(app.pointing.provenance.value?.absence).toBe('unknownToTheGraph')
  })

  /* A run replaces the graph, and the answer follows it. */
  it('answers again when a run lands', () => {
    const app = setup({ graph: new Map() })
    app.pointing.point({ at: { kind: 'entity', id: 'wall' }, from: 'scene' })

    app.graph.value = artifacts

    expect(app.pointing.provenance.value?.absence).toBeNull()
    expect(app.pointing.provenance.value?.ranges).toHaveLength(2)
  })

  it('works with nothing rendering at all', () => {
    const pointing = createPointing({
      artifacts: signal(artifacts),
      highlighter: () => undefined,
    })
    pointing.start()
    dispose = pointing.dispose

    expect(() =>
      pointing.point({ at: { kind: 'offset', offset: 190 }, from: 'code' })
    ).not.toThrow()
    expect(pointing.provenance.value?.entities).toHaveLength(3)
  })

  it('stops talking once disposed', () => {
    const app = setup()
    app.pointing.dispose()
    app.highlight.mockClear()

    app.pointing.point({ at: { kind: 'offset', offset: 190 }, from: 'code' })

    expect(app.highlight).not.toHaveBeenCalled()
  })
})
