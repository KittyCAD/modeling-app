import type { Program } from '@rust/kcl-lib/bindings/Program'
import { describe, expect, it } from 'vitest'
import { artifactsFrom } from '@src/lib/kcl/artifacts'
import {
  faceReference,
  faceReferenceUnavailable,
  solidReference,
} from '@src/lib/kcl/faceReferences'

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
      source: 'faceOf(extrude001, face = END)',
      via: 'cap',
    })
  })

  it('tells the two ends apart', () => {
    expect(faceReference('capStart', context())?.source).toBe(
      'faceOf(extrude001, face = START)'
    )
  })
})

describe('naming a side face', () => {
  /* A wall has no name of its own: it is the segment that was swept. */
  it('goes through the swept segment when the sweep took one directly', () => {
    expect(faceReference('wall', context())).toEqual({
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
      source: 'faceOf(extrude001, face = region001.tags.line1)',
      via: 'wall.regionTag',
    })
  })

  it('is nothing when the solid has no name in this file', () => {
    const orphaned = { artifacts: graph, program: program() }

    expect(faceReference('wall', orphaned)).toBeNull()
    expect(faceReference('capEnd', orphaned)).toBeNull()
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

describe('saying why a face cannot be named', () => {
  it('blames the missing solid when the face is one we understand', () => {
    const orphaned = { artifacts: graph, program: program() }

    expect(faceReferenceUnavailable('wall', orphaned)).toMatch(/does not name/)
  })

  it('says nothing about things that were never faces', () => {
    expect(faceReferenceUnavailable('seg', context())).toBeNull()
  })

  it('has an answer for a face the graph does not report', () => {
    expect(faceReferenceUnavailable('unknown', context())).toMatch(
      /does not report/
    )
  })
})
