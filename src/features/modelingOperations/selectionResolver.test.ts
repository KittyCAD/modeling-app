import type { Program } from '@rust/kcl-lib/bindings/Program'
import { computed } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import type { KclSceneService } from '@src/contracts/kclScene'
import type { ParsedProgram } from '@src/contracts/modelingOperations'
import type { SelectedEntity, SelectionService } from '@src/contracts/selection'
import { createSelectionResolver } from '@src/features/modelingOperations/selectionResolver'
import { artifactsFrom, sourceRangeFor } from '@src/lib/kcl/artifacts'
import type { DerivedInput } from '@src/lib/kclStdlib/shapes'
import { parseKclType } from '@src/lib/kclStdlib/types'

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

const declare = (bound: string, init: unknown, span: [number, number]) =>
  ({
    ...node,
    type: 'VariableDeclaration',
    start: span[0],
    end: span[1],
    kind: 'const',
    declaration: {
      ...node,
      type: 'VariableDeclarator',
      id: { ...node, type: 'Identifier', name: bound },
      init,
    },
  }) as unknown

/** `triangle` holding `line1`, swept by `extrude001`. */
const ast = {
  body: [
    {
      ...node,
      type: 'VariableDeclaration',
      start: 0,
      end: 99,
      kind: 'const',
      declaration: {
        ...node,
        type: 'VariableDeclarator',
        id: { ...node, type: 'Identifier', name: 'triangle' },
        init: {
          ...node,
          type: 'SketchBlock',
          arguments: [],
          body: {
            ...node,
            type: 'Block',
            items: [
              declare(
                'line1',
                {
                  ...node,
                  type: 'CallExpressionKw',
                  unlabeled: null,
                  arguments: [],
                  callee: name('line'),
                },
                [30, 60]
              ),
            ],
          },
        },
      },
    },
    declare(
      'extrude001',
      {
        ...node,
        type: 'CallExpressionKw',
        unlabeled: name('triangle'),
        arguments: [],
        callee: name('extrude'),
      },
      [160, 220]
    ),
  ],
} as unknown as Program

const artifacts = artifactsFrom({
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

/**
 * The two ids that are default planes rather than geometry.
 *
 * They are in no artifact and no file: nothing declares `XY`, so the graph has
 * nothing to say about a click on one and the entity arrives named only by
 * whatever drew it.
 */
const PLANES: Readonly<Record<string, SelectedEntity['defaultPlane']>> = {
  'plane-xy': { plane: 'xy', facing: 'front' },
  'plane-neg-yz': { plane: 'yz', facing: 'back' },
}

const entity = (entityId: string): SelectedEntity => ({
  entityId,
  kind: artifacts.get(entityId)?.type ?? null,
  sourceRange: sourceRangeFor(artifacts, entityId),
  defaultPlane: PLANES[entityId] ?? null,
  region: null,
})

const resolver = (selected: readonly string[]) => {
  const selection = {
    entities: computed(() => selected.map((id) => entity(id))),
  } as unknown as SelectionService

  const scene = {
    artifacts: computed(() => artifacts),
    artifactFor: (id: string) => artifacts.get(id),
    sourceRangeFor: (id: string) => sourceRangeFor(artifacts, id),
    program: computed(() => null),
  } as unknown as KclSceneService

  return createSelectionResolver(
    () => selection,
    () => scene
  )
}

const input = (type: string): DerivedInput => ({
  name: 'on',
  type: parseKclType(type),
  docs: null,
  required: true,
  special: true,
  experimental: false,
  deprecated: false,
})

const answer = (selected: readonly string[], type: string) =>
  resolver(selected).toArgument?.(selected.join(' '), {
    input: input(type),
    program: { source: '', ast } as unknown as ParsedProgram,
    resolved: {},
  })

/*
 * A default plane is the one selectable thing that is already written down.
 * Every other case here works by finding what the *file* calls something.
 */
describe('answering by clicking a default plane', () => {
  it('writes the plane itself', () => {
    expect(answer(['plane-xy'], 'Plane | Face | TaggedFace')?.source).toBe('XY')
  })

  /* Clicking the underside is how you sketch there, without a rotation. */
  it('writes the negative when you clicked the back of one', () => {
    expect(answer(['plane-neg-yz'], 'Plane | Face | TaggedFace')?.source).toBe(
      '-YZ'
    )
  })

  it('writes nothing above it, because there is nothing to declare', () => {
    expect(
      answer(['plane-xy'], 'Plane | Face | TaggedFace')?.prerequisites
    ).toEqual([])
  })

  /*
   * `shell(faces = …)` does not take a plane, and writing one would produce KCL
   * that fails on the next run with nothing to connect it to the click.
   */
  it('refuses an argument a plane cannot answer', () => {
    const written = answer(['plane-xy'], '[TaggedFace; 1+]')

    expect(written?.source).toBe('')
    expect(written?.unavailable).toBeTruthy()
  })

  it('takes its place in a list beside real geometry', () => {
    expect(answer(['plane-xy', 'seg'], '[Plane; 1+]')?.source).toBe(
      '[XY, triangle.line1]'
    )
  })
})

/*
 * The same click means different things to different arguments, which is the
 * whole reason the argument's type is consulted.
 */
describe('answering a face argument by clicking', () => {
  it('writes a face reference for a side face', () => {
    expect(answer(['wall'], 'Plane | Face | TaggedFace')?.source).toBe(
      'faceOf(extrude001, face = triangle.line1)'
    )
  })

  it('writes a position for an end cap', () => {
    expect(answer(['cap'], 'Plane | Face | TaggedFace')?.source).toBe(
      'faceOf(extrude001, face = END)'
    )
  })

  it('writes the segment itself when the argument wants a segment', () => {
    expect(answer(['wall'], '[Segment; 1+]')?.source).toBe('triangle.line1')
  })

  it('writes the segment when the argument wants a sketch', () => {
    // `extrude(sketches = …)` takes a Sketch, so a click on geometry answers
    // with what the program calls it rather than as a face.
    expect(answer(['wall'], 'Sketch')?.source).toBe('triangle.line1')
  })

  it('falls back to the name for a thing that is not a face', () => {
    expect(answer(['seg'], 'Plane | Face | TaggedFace')?.source).toBe(
      'triangle.line1'
    )
  })

  it('lists several faces as several references', () => {
    expect(answer(['wall', 'cap'], '[TaggedFace; 1+]')?.source).toBe(
      '[faceOf(extrude001, face = triangle.line1), faceOf(extrude001, face = END)]'
    )
  })

  it('has nothing to say about an entity it cannot place', () => {
    expect(answer(['mystery'], 'Face')?.source).toBe('')
  })
})

/*
 * How many entities an argument takes is read from its type, so the prompt is
 * told the truth without anybody declaring it per operation.
 */
describe('how many entities a selection argument takes', () => {
  const promptFor = async (type: string) => {
    const prompt = await resolver([]).prompt({
      input: input(type),
      program: { source: '', ast } as unknown as ParsedProgram,
      resolved: {},
    })
    if (prompt.kind !== 'selection') throw new Error('expected a selection')
    return prompt
  }

  it('takes several when the type is a list', async () => {
    expect((await promptFor('[TaggedFace; 1+]')).multiple).toBe(true)
  })

  it('takes one when the type is not', async () => {
    expect((await promptFor('Solid')).multiple).toBeUndefined()
  })

  it('takes one when the list holds exactly one', async () => {
    expect((await promptFor('[Solid; 1]')).multiple).toBeUndefined()
  })

  it('says which types would answer', async () => {
    // In the order the type declares them, which is the order KCL's docs use.
    expect((await promptFor('Plane | Face | TaggedFace')).accepts).toEqual([
      'Plane',
      'Face',
      'TaggedFace',
    ])
  })
})

/*
 * A face nobody can name has to say so. Falling through to what the program
 * calls the code that made it writes `region001` into an argument wanting a
 * face — KCL that fails on the next run, with nothing connecting the failure to
 * the click.
 */
describe('a face that cannot be referred to', () => {
  const REGION_CALL = 321

  const regionArtifacts = artifactsFrom({
    map: {
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
    },
  })

  /** `region001 = region(…)` at 309..368, swept at 369..413. */
  const regionAst = {
    body: [
      declare(
        'region001',
        {
          ...node,
          type: 'CallExpressionKw',
          unlabeled: null,
          arguments: [],
          callee: name('region'),
        },
        [309, 368]
      ),
      declare(
        'extrude001',
        {
          ...node,
          type: 'CallExpressionKw',
          unlabeled: name('region001'),
          arguments: [],
          callee: name('extrude'),
        },
        [369, 413]
      ),
    ],
  } as unknown as Program

  const answerFor = (type: string) => {
    const selection = {
      entities: computed(() => [
        {
          entityId: 'wall',
          kind: 'wall' as const,
          sourceRange: sourceRangeFor(regionArtifacts, 'wall'),
          region: null,
        },
      ]),
    } as unknown as SelectionService

    const scene = {
      artifacts: computed(() => regionArtifacts),
      artifactFor: (id: string) => regionArtifacts.get(id),
      sourceRangeFor: (id: string) => sourceRangeFor(regionArtifacts, id),
      program: computed(() => null),
    } as unknown as KclSceneService

    return createSelectionResolver(
      () => selection,
      () => scene
    ).toArgument?.('wall', {
      input: input(type),
      program: { source: '', ast: regionAst } as unknown as ParsedProgram,
      resolved: {},
    })
  }

  it('writes nothing, and says why', () => {
    const answer = answerFor('Plane | Face | TaggedFace')

    expect(answer?.source).toBe('')
    expect(answer?.unavailable).toMatch(/Nothing in this file names that face/)
  })

  it('does not offer the region as a face', () => {
    expect(answerFor('Plane | Face | TaggedFace')?.source).not.toContain(
      'region001'
    )
  })

  /* An argument that wants the segment still gets what the program calls it. */
  it('leaves a non-face argument alone', () => {
    expect(answerFor('[Segment; 1+]')?.source).toBe('region001')
  })
})
