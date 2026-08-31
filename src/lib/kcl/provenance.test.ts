import { describe, expect, it } from 'vitest'
import { artifactsFrom } from '@src/lib/kcl/artifacts'
import {
  type Provenance,
  type ProvenanceRole,
  provenanceAt,
  provenanceOf,
} from '@src/lib/kcl/provenance'

const codeRef = (start: number, end: number) => ({
  range: [start, end, 0] as [number, number, number],
  nodePath: {} as never,
  pathToNode: [],
})

const graph = (entries: Record<string, unknown>) =>
  artifactsFrom({ map: entries })

/**
 * One sketch, extruded.
 *
 * ```
 * triangle = sketch(on = XY) {   //  [0, 99]
 *   line1 = line(…)              // [30, 60]
 * }
 * extrude001 = extrude(triangle) // [160, 220]
 * ```
 *
 * `wall` and `cap` carry no code of their own, which is the whole reason this
 * module exists: kcl-lib says so in the type, and the two things they lead to
 * are different answers to different questions.
 */
const solid = graph({
  plane: {
    type: 'plane',
    id: 'plane',
    pathIds: ['path'],
    codeRef: codeRef(18, 20),
  },
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
    edgeIds: ['edge'],
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
    edgeIds: ['edge'],
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
  edge: {
    type: 'sweepEdge',
    id: 'edge',
    subType: 'opposite',
    segId: 'seg',
    sweepId: 'sweep',
    commonSurfaceIds: [],
    cmdId: 'c3',
  },
})

/** Roles by range start, which is enough to read an assertion by. */
const rangesIn = (found: Provenance): Record<number, ProvenanceRole> =>
  Object.fromEntries(found.ranges.map((mark) => [mark.range[0], mark.role]))

const entitiesIn = (found: Provenance): Record<string, ProvenanceRole> =>
  Object.fromEntries(found.entities.map((mark) => [mark.id, mark.role]))

describe('pointing at something in the scene', () => {
  /*
   * The case that makes the point. There is no single right range for a wall and
   * there never was: the extrude raised it, the line gave it its shape, and both
   * are worth showing. Choosing one is what makes a highlight land somewhere that
   * looks unrelated.
   */
  it('answers a wall with the call that made it and the line it came from', () => {
    const found = provenanceOf(solid, 'wall')

    expect(rangesIn(found)).toEqual({
      160: 'primary', // extrude001 raised it
      30: 'origin', // line1 gave it its shape
    })
  })

  it('puts the primary first, so a decoration can draw it differently', () => {
    expect(provenanceOf(solid, 'wall').ranges[0].role).toBe('primary')
  })

  /* A cap has no segment behind it, so the extrude is the only answer. */
  it('answers a cap with the call alone', () => {
    expect(rangesIn(provenanceOf(solid, 'cap'))).toEqual({ 160: 'primary' })
  })

  /*
   * An artifact with code of its own keeps it, and what it *came from* drops to
   * a supporting role rather than competing with it.
   */
  it('keeps an artifact’s own code as the primary', () => {
    const found = provenanceOf(solid, 'sweep')

    expect(rangesIn(found)[160]).toBe('primary')
  })

  /*
   * `sourceRangeFor` walks the same graph and answers the segment, because it is
   * asked a different question — "what would I edit". Two questions, two walks,
   * and this is the assertion that keeps them from being quietly merged.
   */
  it('disagrees with the selection walk on purpose', () => {
    const found = provenanceOf(solid, 'wall')

    expect(found.ranges[0].range[0]).toBe(160) // the extrude: what made it
    expect(rangesIn(found)[30]).toBe('origin') // the line: what to edit
  })

  it('lights what a thing produced', () => {
    expect(entitiesIn(provenanceOf(solid, 'sweep'))).toMatchObject({
      wall: 'effect',
      cap: 'effect',
      edge: 'effect',
    })
  })

  /* Whoever asked is already showing it; the answer is everything else. */
  it('leaves out the thing that was pointed at', () => {
    expect(entitiesIn(provenanceOf(solid, 'sweep'))).not.toHaveProperty('sweep')
  })
})

describe('pointing at a place in the file', () => {
  /*
   * The direction the existing app never implemented, and where the fan-out is
   * the answer rather than a problem: this is the app saying what the line does.
   */
  it('answers an extrude with everything it made', () => {
    const found = provenanceAt(solid, 190)

    expect(entitiesIn(found)).toMatchObject({
      sweep: 'primary',
      wall: 'effect',
      cap: 'effect',
      edge: 'effect',
    })
  })

  it('returns the range too, because the caller only had an offset', () => {
    expect(provenanceAt(solid, 190).ranges[0]).toEqual({
      range: [160, 220, 0],
      role: 'primary',
    })
  })

  /* Narrowest wins: an offset inside the line is about the line. */
  it('takes the innermost thing at the offset', () => {
    expect(entitiesIn(provenanceAt(solid, 45))).toMatchObject({
      seg: 'primary',
    })
  })

  it('says so when the code drew nothing', () => {
    const found = provenanceAt(solid, 5000)

    expect(found.entities).toEqual([])
    expect(found.absence).toBe('drewNothing')
  })
})

/*
 * "One cursor position may correspond to destroyed geometry." The scene has
 * nothing to light, and the honest answer is the code that defined the thing
 * that is gone.
 */
describe('code that destroys geometry', () => {
  const subtracted = graph({
    bodyPath: {
      type: 'path',
      id: 'bodyPath',
      subType: 'sketch',
      planeId: 'plane',
      segIds: [],
      consumed: true,
      codeRef: codeRef(0, 40),
    },
    body: {
      type: 'sweep',
      id: 'body',
      subType: 'extrusion',
      pathId: 'bodyPath',
      surfaceIds: [],
      edgeIds: [],
      trajectoryId: null,
      codeRef: codeRef(50, 80),
    },
    toolPath: {
      type: 'path',
      id: 'toolPath',
      subType: 'sketch',
      planeId: 'plane',
      segIds: [],
      consumed: true,
      codeRef: codeRef(90, 130),
    },
    tool: {
      type: 'sweep',
      id: 'tool',
      subType: 'extrusion',
      pathId: 'toolPath',
      surfaceIds: [],
      edgeIds: [],
      trajectoryId: null,
      codeRef: codeRef(140, 170),
    },
    cut: {
      type: 'compositeSolid',
      id: 'cut',
      consumed: false,
      subType: 'subtract',
      solidIds: ['body'],
      toolIds: ['tool'],
      codeRef: codeRef(180, 230),
    },
  })

  it('marks what the call ate, in the code', () => {
    const found = provenanceAt(subtracted, 200)

    expect(rangesIn(found)).toEqual({
      180: 'primary',
      50: 'consumed', // body
      140: 'consumed', // tool
    })
  })

  /*
   * And does not ask the renderer for them. They are named by the file and
   * absent from the scene, which is exactly the state the roles exist to carry.
   */
  it('does not light geometry that is gone', () => {
    const found = provenanceAt(subtracted, 200)

    expect(entitiesIn(found)).not.toHaveProperty('body')
    expect(entitiesIn(found)).not.toHaveProperty('tool')
  })

  /* A path that has been swept is consumed, so pointing at it would point at
     something that is not there. */
  it('treats a swept sketch as consumed rather than as an origin', () => {
    expect(rangesIn(provenanceOf(solid, 'sweep'))[0]).toBe('consumed')
    expect(entitiesIn(provenanceOf(solid, 'sweep'))).not.toHaveProperty('path')
  })

  /*
   * kcl-lib's own name for what a chamfer does to an edge — and a look at the
   * documented rule for supporting marks. The edge has no code, so the answer
   * comes from the ordinary specificity walk and lands on the *line* the edge
   * came from rather than on the extrude, which is the useful end for something
   * one step out from what was asked about.
   */
  it('marks the edge a chamfer consumed', () => {
    const chamfered = graph({
      edge: {
        type: 'sweepEdge',
        id: 'edge',
        subType: 'opposite',
        segId: 'seg',
        sweepId: 'sweep',
        commonSurfaceIds: [],
        cmdId: 'c1',
      },
      seg: {
        type: 'segment',
        id: 'seg',
        pathId: 'p',
        edgeIds: [],
        commonSurfaceIds: [],
        codeRef: codeRef(10, 30),
      },
      sweep: {
        type: 'sweep',
        id: 'sweep',
        subType: 'extrusion',
        pathId: 'p',
        surfaceIds: [],
        edgeIds: ['edge'],
        trajectoryId: null,
        codeRef: codeRef(40, 70),
      },
      chamfer: {
        type: 'edgeCut',
        id: 'chamfer',
        subType: 'chamfer',
        consumedEdgeId: 'edge',
        edgeIds: [],
        codeRef: codeRef(100, 140),
      },
    })

    expect(rangesIn(provenanceAt(chamfered, 120))).toMatchObject({
      100: 'primary',
      10: 'consumed', // the edge, answered by the line it came from
    })
  })
})

/*
 * The most valuable answers, and the ones the existing app cannot express: it
 * lights nothing and you conclude it is broken. Each of these is a different
 * true statement.
 */
describe('when there is nothing to point at', () => {
  it('says the graph has never heard of it', () => {
    const found = provenanceOf(solid, 'some-region-the-engine-picked')

    expect(found).toEqual({
      ranges: [],
      entities: [],
      absence: 'unknownToTheGraph',
    })
  })

  it('says nothing in the file wrote it', () => {
    const orphan = graph({
      face: {
        type: 'wall',
        id: 'face',
        segId: 'missing',
        sweepId: 'missing',
        edgeCutEdgeIds: [],
        pathIds: [],
        faceCodeRef: codeRef(0, 0),
        cmdId: 'c1',
      },
    })

    expect(provenanceOf(orphan, 'face').absence).toBe('noCodeInAncestry')
  })

  /*
   * A wall's own `faceCodeRef` describes the sketch-on-face plane, not the wall,
   * and kcl-lib says so in the type. Using it would put the highlight on a
   * `startSketchOn` somebody never wrote.
   */
  it('never mistakes a face code ref for the face’s code', () => {
    const found = provenanceOf(solid, 'wall')

    expect(rangesIn(found)).not.toHaveProperty('0')
  })
})

describe('graphs that would trip a naive walk', () => {
  /* A wall names its sweep and the sweep names its surfaces. */
  it('terminates on the cycles the graph really has', () => {
    expect(() => provenanceOf(solid, 'wall')).not.toThrow()
    expect(() => provenanceAt(solid, 190)).not.toThrow()
  })

  it('ignores ids that lead nowhere', () => {
    const dangling = graph({
      sweep: {
        type: 'sweep',
        id: 'sweep',
        subType: 'extrusion',
        pathId: 'gone',
        surfaceIds: ['also-gone'],
        edgeIds: [],
        trajectoryId: null,
        codeRef: codeRef(10, 20),
      },
    })

    expect(provenanceOf(dangling, 'sweep')).toEqual({
      ranges: [{ range: [10, 20, 0], role: 'primary' }],
      entities: [],
      absence: null,
    })
  })

  it('is empty for an empty graph', () => {
    expect(provenanceAt(graph({}), 0).absence).toBe('drewNothing')
    expect(provenanceOf(graph({}), 'anything').absence).toBe(
      'unknownToTheGraph'
    )
  })
})
