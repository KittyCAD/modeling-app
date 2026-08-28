import type { Program } from '@rust/kcl-lib/bindings/Program'
import { describe, expect, it } from 'vitest'
import { artifactsFrom } from '@src/lib/kcl/artifacts'
import {
  faceReference,
  solidReference,
  sweptPathFor,
} from '@src/lib/kcl/faceReferences'

/** The source of a lookup that produced one, or the reason it did not. */
const sourceOf = (lookup: ReturnType<typeof faceReference>) =>
  lookup?.kind === 'reference' ? lookup.source : null
const reasonOf = (lookup: ReturnType<typeof faceReference>) =>
  lookup?.kind === 'unavailable' ? lookup.reason : null

const codeRef = (start: number, end: number) => ({
  range: [start, end, 0] as [number, number, number],
  nodePath: {} as never,
  pathToNode: [],
})

const node = { start: 0, end: 0, moduleId: 0, commentStart: 0 }

const name = (value: string) => ({
  ...node,
  type: 'Name',
  abs_path: false,
  path: [],
  name: { ...node, type: 'Identifier', name: value },
})

const call = (callee: string, unlabeled: unknown = null) => ({
  ...node,
  type: 'CallExpressionKw',
  unlabeled,
  arguments: [],
  callee: name(callee),
})

const declare = (
  bound: string,
  init: unknown,
  [start, end]: [number, number]
) =>
  ({
    ...node,
    type: 'VariableDeclaration',
    start,
    end,
    kind: 'const',
    declaration: {
      ...node,
      type: 'VariableDeclarator',
      id: { ...node, type: 'Identifier', name: bound },
      init,
    },
  }) as unknown

const sketchWithSegment = (
  bound: string,
  segment: string,
  outer: [number, number],
  inner: [number, number]
) =>
  ({
    ...node,
    type: 'VariableDeclaration',
    start: outer[0],
    end: outer[1],
    kind: 'const',
    declaration: {
      ...node,
      type: 'VariableDeclarator',
      id: { ...node, type: 'Identifier', name: bound },
      init: {
        ...node,
        type: 'SketchBlock',
        arguments: [],
        body: {
          ...node,
          type: 'Block',
          items: [declare(segment, call('line'), inner)],
        },
      },
    },
  }) as unknown

const program = (...body: unknown[]) => ({ body }) as unknown as Program

/**
 * `region(segments = [s.l1, s.l2], direction = CW)` with the reported file's
 * offsets, so the segment list can be sliced back out of the source.
 */
const regionCall = () => ({
  ...node,
  type: 'CallExpressionKw',
  unlabeled: null,
  callee: name('region'),
  arguments: [
    {
      ...node,
      label: { ...node, type: 'Identifier', name: 'segments' },
      arg: {
        ...node,
        type: 'ArrayExpression',
        start: 339,
        end: 351,
        elements: [
          { ...node, type: 'Name', start: 340, end: 344 },
          { ...node, type: 'Name', start: 346, end: 350 },
        ],
      },
    },
  ],
})

/**
 * `triangle = sketch(on = XY) { line1 = line(...) }` at 0–99, the segment at
 * 30–60, then a region and an extrude that consumes it.
 */
const sketchProgram = (options: { region?: boolean } = {}) =>
  program(
    sketchWithSegment('triangle', 'line1', [0, 99], [30, 60]),
    ...(options.region
      ? [declare('region001', call('region'), [100, 150])]
      : []),
    declare(
      'extrude001',
      call('extrude', options.region ? name('region001') : name('triangle')),
      [160, 220]
    )
  )

const graph = artifactsFrom({
  map: {
    seg: { type: 'segment', id: 'seg', pathId: 'p', codeRef: codeRef(35, 55) },
    sweep: {
      type: 'sweep',
      id: 'sweep',
      subType: 'extrusion',
      pathId: 'p',
      surfaceIds: [],
      edgeIds: [],
      codeRef: codeRef(170, 210),
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
    capEnd: {
      type: 'cap',
      id: 'capEnd',
      subType: 'end',
      sweepId: 'sweep',
      edgeCutEdgeIds: [],
      pathIds: [],
      faceCodeRef: codeRef(0, 0),
      cmdId: 'c2',
    },
    capStart: {
      type: 'cap',
      id: 'capStart',
      subType: 'start',
      sweepId: 'sweep',
      edgeCutEdgeIds: [],
      pathIds: [],
      faceCodeRef: codeRef(0, 0),
      cmdId: 'c3',
    },
  },
})

const context = (options: { region?: boolean } = {}) => ({
  artifacts: graph,
  program: sketchProgram(options),
})

describe('naming the solid a face belongs to', () => {
  it('is the binding holding the sweep that made it', () => {
    expect(solidReference('sweep', context())).toBe('extrude001')
  })

  it('is nothing for an id that is not a sweep', () => {
    expect(solidReference('wall', context())).toBeNull()
    expect(solidReference('nope', context())).toBeNull()
  })
})

describe('naming an end cap', () => {
  /*
   * A cap is a position rather than a reference, which is what kcl-lib writes
   * today — with its own note that it should become a tag.
   */
  it('is the end of the sweep it caps', () => {
    expect(faceReference('capEnd', context())).toEqual({
      kind: 'reference',
      source: 'faceOf(extrude001, face = END)',
      via: 'cap',
    })
  })

  it('tells the two ends apart', () => {
    expect(sourceOf(faceReference('capStart', context()))).toBe(
      'faceOf(extrude001, face = START)'
    )
  })
})

describe('naming a side face', () => {
  /* A wall has no name of its own: it is the segment that was swept. */
  it('goes through the swept segment when the sweep took one directly', () => {
    expect(faceReference('wall', context())).toEqual({
      kind: 'reference',
      source: 'faceOf(extrude001, face = triangle.line1)',
      via: 'wall.segment',
    })
  })

  /*
   * A region consumes the segments it is built from and re-exposes them as tags,
   * so a swept region's wall is addressed through the region.
   */
  it('goes through the region tags when the sweep consumed a region', () => {
    expect(faceReference('wall', context({ region: true }))).toEqual({
      kind: 'reference',
      source: 'faceOf(extrude001, face = region001.tags.line1)',
      via: 'wall.regionTag',
    })
  })

  it('says why when the solid has no name in this file', () => {
    const orphaned = { artifacts: graph, program: program() }

    expect(reasonOf(faceReference('wall', orphaned))).toMatch(/does not name/)
    expect(reasonOf(faceReference('capEnd', orphaned))).toMatch(/does not name/)
  })
})

describe('what is not a face', () => {
  it('has no face reference, so a caller falls back to its own name', () => {
    expect(faceReference('seg', context())).toBeNull()
    expect(faceReference('sweep', context())).toBeNull()
  })

  it('is not a face when the graph has never heard of it', () => {
    expect(faceReference('unknown', context())).toBeNull()
  })
})

/*
 * The reported case, with the offsets and the graph shape it actually has.
 *
 * ```
 * s = sketch(on = XY) { l1 = … l2 = … l3 = … }   41..308
 * region001 = region(segments = [s.l1, s.l2])   309..368
 * extrude001 = extrude(region001, length = 10)  369..413
 * ```
 *
 * Every segment a region builds carries the range of the `region(…)` call — 321
 * here — so all four walls of the swept region point at the same code and none of
 * them can be told apart. kcl-lib's own graph snapshots show the same thing.
 */
describe('a side face of a swept region', () => {
  const REGION_CALL = 321

  /** The reported file, whose offsets these are. */
  const SOURCE = `@settings(experimentalFeatures = allow)

s = sketch(on = XY) {
  l1 = line(start=[0,0], end=[5, 5])
  l2 = line(start=[var 5, var 5], end=[var 5, var 0])
  l3 = line(start=[var 0, var 0], end=[var 6, var 0])
  coincident([l1.end, l2.start])
  coincident([l2.end, l3.end])
  coincident([l1.start, l3.start])
}
region001 = region(segments = [s.l1, s.l2], direction = CW)
extrude001 = extrude(region001, length = 10)
`

  const sweptRegion = {
    artifacts: artifactsFrom({
      map: {
        // The region's own segment: its code is the region call, not a line.
        regionSeg: {
          type: 'segment',
          id: 'regionSeg',
          pathId: 'regionPath',
          codeRef: codeRef(REGION_CALL, 367),
        },
        sweep: {
          type: 'sweep',
          id: 'sweep',
          subType: 'extrusion',
          pathId: 'regionPath',
          surfaceIds: [],
          edgeIds: [],
          codeRef: codeRef(382, 413),
        },
        wall: {
          type: 'wall',
          id: 'wall',
          segId: 'regionSeg',
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
    }),
    program: program(
      sketchWithSegment('s', 'l1', [41, 308], [63, 99]),
      declare('region001', regionCall(), [309, 368]),
      declare('extrude001', call('extrude', name('region001')), [369, 413])
    ),
  }

  /*
   * It used to answer `faceOf(extrude001, face = region001.tags.region001)` —
   * using the region's name where a segment's belongs — and the caller then wrote
   * nothing at all, so the dialog said the argument was missing while showing the
   * face that had been picked.
   */
  it('says it cannot be named, rather than naming the region twice', () => {
    const lookup = faceReference('wall', sweptRegion)

    expect(lookup?.kind).toBe('unavailable')
    expect(reasonOf(lookup)).toMatch(/does not say which segment/)
  })

  /*
   * Being told it cannot be done is not much use on its own. The solid's name and
   * the shape of the call are known; which segment was clicked is the one thing
   * only the user knows, so that is the only thing left to supply.
   */
  it('suggests a reference quoted from the file', () => {
    const withSource = {
      ...sweptRegion,
      source: SOURCE,
    }

    expect(reasonOf(faceReference('wall', withSource))).toContain(
      'faceOf(extrude001, face = s.l1)'
    )
  })

  it('suggests the shape of the call when it cannot quote one', () => {
    expect(reasonOf(faceReference('wall', sweptRegion))).toContain(
      'faceOf(extrude001, face = <segment>)'
    )
  })

  it('names the end cap of the same solid, which is the planar face', () => {
    expect(sourceOf(faceReference('cap', sweptRegion))).toBe(
      'faceOf(extrude001, face = END)'
    )
  })
})

/*
 * When the engine names a curve the graph flattened, that curve is the one worth
 * writing — it may still be a line somebody can point at in the file.
 */
describe('a face named from the engine curve', () => {
  const withSketchSegment = {
    artifacts: artifactsFrom({
      map: {
        regionSeg: {
          type: 'segment',
          id: 'regionSeg',
          pathId: 'regionPath',
          codeRef: codeRef(309, 367),
        },
        sketchSeg: {
          type: 'segment',
          id: 'sketchSeg',
          pathId: 'sketchPath',
          codeRef: codeRef(70, 90),
        },
        sweep: {
          type: 'sweep',
          id: 'sweep',
          subType: 'extrusion',
          pathId: 'regionPath',
          surfaceIds: [],
          edgeIds: [],
          codeRef: codeRef(382, 413),
        },
        wall: {
          type: 'wall',
          id: 'wall',
          segId: 'regionSeg',
          sweepId: 'sweep',
          edgeCutEdgeIds: [],
          pathIds: [],
          faceCodeRef: codeRef(0, 0),
          cmdId: 'c1',
        },
      },
    }),
    program: program(
      sketchWithSegment('s', 'l1', [41, 308], [63, 99]),
      declare('region001', regionCall(), [309, 368]),
      declare('extrude001', call('extrude', name('region001')), [369, 413])
    ),
  }

  it('uses the engine curve when the graph segment has no name', () => {
    expect(
      sourceOf(faceReference('wall', withSketchSegment, 'sketchSeg'))
    ).toBe('faceOf(extrude001, face = region001.tags.l1)')
  })

  it('still cannot name it when the engine offers nothing', () => {
    expect(faceReference('wall', withSketchSegment)?.kind).toBe('unavailable')
  })

  it('ignores an engine curve that is no more nameable', () => {
    expect(faceReference('wall', withSketchSegment, 'regionSeg')?.kind).toBe(
      'unavailable'
    )
  })

  /** The path the engine has to be asked about is the segment's own. */
  it('finds the path a face belongs to', () => {
    expect(sweptPathFor('wall', withSketchSegment)).toBe('regionPath')
    expect(sweptPathFor('sweep', withSketchSegment)).toBeNull()
  })
})
