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

const entity = (entityId: string): SelectedEntity => ({
  entityId,
  kind: artifacts.get(entityId)?.type ?? null,
  sourceRange: sourceRangeFor(artifacts, entityId),
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
