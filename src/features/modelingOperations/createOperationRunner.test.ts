import type { Program } from '@rust/kcl-lib/bindings/Program'
import { computed, signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { combineCapabilities } from '@src/contracts/buffers'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import type { KclSceneService } from '@src/contracts/kclScene'
import type {
  ArgumentResolver,
  ModelingOperation,
} from '@src/contracts/modelingOperations'
import type { SelectedEntity, SelectionService } from '@src/contracts/selection'
import type { ProjectSession } from '@src/contracts/projectSession'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { createOperationRunner } from '@src/features/modelingOperations/createOperationRunner'
import { operationFor } from '@src/features/modelingOperations/operations/catalog'
import {
  bindingResolver,
  builtInResolvers,
  expressionResolver,
} from '@src/features/modelingOperations/resolvers'
import { createSelectionResolver } from '@src/features/modelingOperations/selectionResolver'
import { namedTypesIn } from '@src/lib/kclStdlib/types'

/**
 * A program with the bindings a test cares about.
 *
 * Hand-built rather than parsed, because the runner takes `parse` as a
 * dependency precisely so a test does not need fifteen megabytes of WebAssembly
 * to answer a question about argument order.
 */
/**
 * A sketch block with named segments, as V2 writes them.
 *
 * `triangle = sketch(on = XY) { line1 = line(...) }` — which is what makes
 * `triangle.line1` the way to refer to a segment from outside the block, and so
 * what a region's `segments` argument is made of.
 */
function sketchBlockProgram(): Program {
  const node = { start: 0, end: 0, moduleId: 0, commentStart: 0 }
  const declare = (name: string, start: number, end: number) => ({
    ...node,
    type: 'VariableDeclaration',
    start,
    end,
    kind: 'const',
    declaration: {
      ...node,
      type: 'VariableDeclarator',
      id: { ...node, type: 'Identifier', name },
      init: {
        ...node,
        type: 'CallExpressionKw',
        unlabeled: null,
        arguments: [],
        callee: {
          ...node,
          type: 'Name',
          abs_path: false,
          path: [],
          name: { ...node, type: 'Identifier', name: 'line' },
        },
      },
    },
  })

  return {
    body: [
      {
        ...node,
        type: 'VariableDeclaration',
        start: 0,
        end: 120,
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
              items: [declare('line1', 30, 60), declare('line2', 61, 95)],
            },
          },
        },
      },
    ],
  } as unknown as Program
}

function programWith(bindings: { name: string; via: string }[]): Program {
  const node = { start: 0, end: 0, moduleId: 0, commentStart: 0 }

  return {
    body: bindings.map((entry, index) => ({
      ...node,
      type: 'VariableDeclaration',
      start: index * 40,
      end: index * 40 + 39,
      kind: 'const',
      declaration: {
        ...node,
        type: 'VariableDeclarator',
        id: { ...node, type: 'Identifier', name: entry.name },
        init: {
          ...node,
          type: 'CallExpressionKw',
          unlabeled: null,
          arguments: [],
          callee: {
            ...node,
            type: 'Name',
            abs_path: false,
            path: [],
            name: { ...node, type: 'Identifier', name: entry.via },
          },
        },
      },
    })),
  } as unknown as Program
}

function setup(
  options: {
    source?: string
    bindings?: { name: string; via: string }[]
    languageId?: string
    operations?: ModelingOperation[]
    resolvers?: ArgumentResolver[]
    /** A V2 sketch block instead of the flat program. */
    sketchBlock?: boolean
  } = {}
) {
  const source =
    options.source ?? 'profile001 = startProfile(XY, at = [0, 0])\n'

  const buffer = createFileBackedTextBuffer({
    path: '/projects/bracket/main.kcl',
    contents: source,
    languageId: options.languageId ?? 'kcl',
    capabilities: combineCapabilities([]),
  })

  const buffers = signal<readonly FileBackedTextBuffer[]>([buffer])
  const session = {
    activeBuffer: computed(() => buffers.value[0] ?? null),
    buffers,
    relativePathFor: () => 'main.kcl',
    bufferForPath: (path: string) => (path === 'main.kcl' ? buffer : undefined),
  } as unknown as ProjectSession

  const runner = createOperationRunner({
    operations: computed(() => options.operations ?? [extrudeOperation]),
    resolvers: computed(() => options.resolvers ?? builtInResolvers),
    session: () => session,
    parse: async (text) => ({
      source: text,
      ast: options.sketchBlock
        ? sketchBlockProgram()
        : programWith(
            options.bindings ?? [{ name: 'profile001', via: 'startProfile' }]
          ),
    }),
  })

  return { runner, buffer }
}

describe('running a modelling operation', () => {
  it('asks for the sketch, then the length, then writes the call', async () => {
    const { runner, buffer } = setup()

    await runner.start('modeling.extrude')

    // The first argument is the special one: what the operation acts on. Its
    // options are derived from what each binding's initialiser returns.
    const first = runner.pending.value
    expect(first?.inputs[first.index].name).toBe('sketches')
    expect(first?.prompt).toMatchObject({
      kind: 'choice',
      options: [
        {
          value: 'profile001',
          label: 'profile001',
          detail: 'Sketch from startProfile',
        },
      ],
    })

    await runner.answer('profile001')

    const second = runner.pending.value
    expect(second?.inputs[second.index].name).toBe('length')
    expect(second?.prompt).toEqual({
      kind: 'expression',
      unit: 'Length',
      placeholder: '10',
    })

    await runner.answer('12')

    expect(runner.pending.value).toBeNull()
    expect(buffer.text.value).toBe(
      'profile001 = startProfile(XY, at = [0, 0])\nextrude001 = extrude(profile001, length = 12)\n'
    )
  })

  /** An optional argument left blank is left out of the call, not written empty. */
  it('omits an optional argument nobody answered', async () => {
    const { runner, buffer } = setup()

    await runner.start('modeling.extrude')
    await runner.answer('profile001')
    await runner.answer('')

    expect(buffer.text.value).toContain('extrude001 = extrude(profile001)')
    expect(buffer.text.value).not.toContain('length =')
  })

  it('will not let a required argument be skipped', async () => {
    const { runner, buffer } = setup()

    await runner.start('modeling.extrude')
    await runner.answer('')

    expect(runner.pending.value?.error).toMatch(/sketches is needed/)
    expect(buffer.text.value).not.toContain('extrude')
  })

  /**
   * The name comes from the program, so running twice does not produce two
   * bindings with the same name.
   */
  it('names the result something free', async () => {
    const { runner, buffer } = setup({
      bindings: [
        { name: 'profile001', via: 'startProfile' },
        { name: 'extrude001', via: 'extrude' },
      ],
    })

    await runner.start('modeling.extrude')
    await runner.answer('profile001')
    await runner.answer('5')

    expect(buffer.text.value).toContain('extrude002 = extrude(')
  })

  /*
   * An empty list of candidates is a reason to offer another way, not a wall.
   * The explanation is still one method-switch away, on the method that has
   * nothing to offer.
   */
  it('falls through to typing when the file has nothing to extrude', async () => {
    const { runner } = setup({ bindings: [] })

    await runner.start('modeling.extrude')

    expect(runner.pending.value?.error).toBeNull()
    expect(runner.pending.value?.method).toBe('modeling.resolver.source')
    expect(runner.pending.value?.prompt.kind).toBe('expression')
  })

  it('still says so when typing is not offered either', async () => {
    const { runner } = setup({
      bindings: [],
      resolvers: [bindingResolver],
    })

    await runner.start('modeling.extrude')

    expect(runner.pending.value?.error).toMatch(/Nothing in this file produces/)
  })

  it('does not offer to run against a file that is not KCL', async () => {
    const { runner, buffer } = setup({ languageId: 'markdown' })

    expect(runner.available.value).toEqual([])
    await runner.start('modeling.extrude')

    expect(runner.pending.value).toBeNull()
    expect(buffer.text.value).not.toContain('extrude')
  })

  it('is abandoned by cancelling, leaving nothing behind', async () => {
    const { runner, buffer } = setup()

    await runner.start('modeling.extrude')
    runner.cancel()

    expect(runner.pending.value).toBeNull()
    expect(buffer.text.value).not.toContain('extrude')
  })

  /** An optional argument no resolver claims is skipped rather than stalling. */
  it('skips an argument nothing knows how to ask for', async () => {
    const operation: ModelingOperation = {
      ...extrudeOperation,
      id: 'modeling.exotic',
      annotations: { prompt: ['method'] },
    }

    // Without the catch-all, `method` is a string nothing claims — which is the
    // case this is about: an optional argument no resolver can ask for is left
    // out rather than blocking the operation.
    const { runner } = setup({
      operations: [operation],
      resolvers: [bindingResolver, expressionResolver],
    })

    await runner.start('modeling.exotic')
    await runner.answer('profile001')

    expect(runner.pending.value).toBeNull()
  })

  it('asks for an argument the catch-all can take, and skips it if empty', async () => {
    const operation: ModelingOperation = {
      ...extrudeOperation,
      id: 'modeling.exotic',
      annotations: { prompt: ['method'] },
    }

    const { runner, buffer } = setup({ operations: [operation] })

    await runner.start('modeling.exotic')
    await runner.answer('profile001')
    expect(runner.pending.value?.method).toBe('modeling.resolver.source')

    await runner.answer('')

    expect(runner.pending.value).toBeNull()
    expect(buffer.text.value).toContain('extrude(profile001)')
  })

  it('appends a newline when the file does not end with one', async () => {
    const { runner, buffer } = setup({
      source: 'profile001 = startProfile(XY, at = [0, 0])',
    })

    await runner.start('modeling.extrude')
    await runner.answer('profile001')
    await runner.answer('3')

    expect(buffer.text.value).toBe(
      'profile001 = startProfile(XY, at = [0, 0])\nextrude001 = extrude(profile001, length = 3)\n'
    )
  })

  it('offers every way of answering, and says which is showing', async () => {
    const { runner } = setup()
    await runner.start('modeling.extrude')

    const state = runner.pending.value
    expect(state?.methods.map((method) => method.label)).toEqual([
      'Existing value',
      'Type it',
    ])
    expect(state?.method).toBe('modeling.resolver.binding')
  })
})

/**
 * A second way to answer a `Sketch`, standing in for the region resolver that
 * arrives with selection.
 *
 * It produces a reference that does not exist in the program yet, so it carries
 * the edit that makes it valid — a segment named at an offset the operation knows
 * nothing about.
 */
const extrudeOperation = operationFor('extrude')

const NAME_A_SEGMENT = { from: 10, to: 10, insert: ' /* named */' }

const regionLike: ArgumentResolver = {
  id: 'test.resolver.region',
  label: 'Region in the scene',
  order: 5,
  handles: (input) => namedTypesIn(input.type).includes('Sketch'),
  prompt: () => ({
    kind: 'choice',
    options: [{ value: 'front', label: 'Front face' }],
  }),
  toArgument: () => ({
    source: 'region001',
    prerequisites: [NAME_A_SEGMENT],
  }),
}

describe('several ways to answer one argument', () => {
  it('lists both methods and offers the first', async () => {
    const { runner } = setup({
      resolvers: [...builtInResolvers, regionLike],
    })

    await runner.start('modeling.extrude')

    const state = runner.pending.value
    expect(state?.methods.map((method) => method.id)).toEqual([
      'modeling.resolver.binding',
      'test.resolver.region',
      // The catch-all sorts last, so it never displaces a method that knows
      // something about the argument.
      'modeling.resolver.source',
    ])
    expect(state?.method).toBe('modeling.resolver.binding')
  })

  it('switches to another method on request, with its own prompt', async () => {
    const { runner } = setup({
      resolvers: [...builtInResolvers, regionLike],
    })

    await runner.start('modeling.extrude')
    await runner.chooseMethod('test.resolver.region')

    const state = runner.pending.value
    expect(state?.method).toBe('test.resolver.region')
    expect(state?.prompt).toMatchObject({
      kind: 'choice',
      options: [{ value: 'front', label: 'Front face' }],
    })
  })

  /**
   * "No sketch in this file" should fall through to picking one in the scene
   * rather than dead-ending on an empty list.
   */
  it('falls through a method with nothing to offer', async () => {
    const { runner } = setup({
      bindings: [],
      resolvers: [...builtInResolvers, regionLike],
    })

    await runner.start('modeling.extrude')

    expect(runner.pending.value?.method).toBe('test.resolver.region')
    expect(runner.pending.value?.error).toBeNull()
  })

  it('uses the chosen method to turn the answer into source', async () => {
    const { runner, buffer } = setup({
      resolvers: [...builtInResolvers, regionLike],
    })

    await runner.start('modeling.extrude')
    await runner.chooseMethod('test.resolver.region')
    await runner.answer('front')
    await runner.answer('4')

    expect(buffer.text.value).toContain('extrude(region001, length = 4)')
  })

  it('ignores a method that cannot answer this argument', async () => {
    const { runner } = setup({
      resolvers: [...builtInResolvers, regionLike],
    })

    await runner.start('modeling.extrude')
    await runner.chooseMethod('modeling.resolver.boolean')

    expect(runner.pending.value?.method).toBe('modeling.resolver.binding')
  })

  /**
   * The reference and the edit that makes it valid land together, in one
   * transaction — so it is one undo entry, and clicking never touched the file.
   */
  it('applies a prerequisite with the operation, not before it', async () => {
    const { runner, buffer } = setup({
      source: 'profile001 = startProfile(XY)\n',
      resolvers: [...builtInResolvers, regionLike],
    })

    await runner.start('modeling.extrude')
    await runner.chooseMethod('test.resolver.region')

    // Nothing has been written yet: the answer is data until the operation is
    // applied.
    expect(buffer.text.value).toBe('profile001 = startProfile(XY)\n')

    await runner.answer('front')
    await runner.answer('7')

    expect(buffer.text.value).toBe(
      'profile001 /* named */ = startProfile(XY)\nextrude001 = extrude(region001, length = 7)\n'
    )
    // One transaction, so one undo step for the whole intention.
    expect(buffer.version.value).toBe(1)
  })

  it('leaves nothing behind when a prerequisite is cancelled', async () => {
    const { runner, buffer } = setup({
      resolvers: [...builtInResolvers, regionLike],
    })

    await runner.start('modeling.extrude')
    await runner.chooseMethod('test.resolver.region')
    await runner.answer('front')
    runner.cancel()

    expect(buffer.text.value).not.toContain('named')
    expect(buffer.text.value).not.toContain('extrude')
  })

  /** Two arguments wanting the same prerequisite must not conflict. */
  it('collapses a prerequisite asked for twice', async () => {
    const twice: ArgumentResolver = {
      ...regionLike,
      id: 'test.resolver.twice',
      handles: () => true,
      prompt: () => ({
        kind: 'choice',
        options: [{ value: 'front', label: 'Front face' }],
      }),
      toArgument: () => ({
        source: 'region001',
        prerequisites: [NAME_A_SEGMENT],
      }),
    }

    const { runner, buffer } = setup({
      source: 'profile001 = startProfile(XY)\n',
      // Claims both arguments, so both answers carry the same prerequisite.
      resolvers: [twice],
    })

    await runner.start('modeling.extrude')
    await runner.answer('front')
    await runner.answer('front')

    // Once, not twice, and no throw about overlapping ranges.
    expect(buffer.text.value.match(/named/g)).toHaveLength(1)
  })
})

/**
 * The chain the selection resolver exists for: an entity the engine reported, a
 * source range from the artifact graph, and the reference that names it.
 */
describe('answering from the scene', () => {
  const entity = (
    over: Partial<SelectedEntity> & { entityId: string }
  ): SelectedEntity => ({
    kind: null,
    sourceRange: null,
    region: null,
    ...over,
  })

  const selectionOf = (entities: SelectedEntity[]): SelectionService => ({
    entities: computed(() => entities),
    picking: computed(() => false),
    select: () => {},
    selectAt: async () => {},
    clear: () => {},
  })

  /** A graph that can place the segments a region borders. */
  const sceneWith = (
    ranges: Record<string, [number, number, number]> = {}
  ): KclSceneService => ({
    artifacts: computed(() => new Map()),
    artifactFor: () => undefined,
    sourceRangeFor: (id) => ranges[id] ?? null,
    // Nothing here asks what the last run read; the resolver works from the
    // program it was handed.
    program: computed(() => null),
  })

  const resolverFor = (
    selection: SelectionService,
    scene: KclSceneService = sceneWith()
  ) => [
    ...builtInResolvers,
    createSelectionResolver(
      () => selection,
      () => scene
    ),
  ]

  it('refers to the binding the clicked geometry came from', async () => {
    // The binding runs 0..39 in the fake program, so offset 5 is inside it.
    const selection = selectionOf([
      entity({ entityId: 'wall', kind: 'wall', sourceRange: [5, 20, 1] }),
    ])

    const { runner, buffer } = setup({ resolvers: resolverFor(selection) })

    await runner.start('modeling.extrude')
    expect(runner.pending.value?.method).toBe('modeling.resolver.selection')
    expect(runner.pending.value?.prompt).toMatchObject({
      kind: 'selection',
      accepts: expect.arrayContaining(['Sketch']),
    })

    // The prompt submits entity ids; the resolver turns them into KCL.
    await runner.answer('wall')
    await runner.answer('9')

    expect(buffer.text.value).toContain('extrude(profile001, length = 9)')
  })

  /**
   * The V2 case, and the one this was missing. A region has no artifact — it does
   * not exist until it is written — so the answer is a new binding *and* a
   * reference to it, both landing with the extrude.
   */
  it('writes a region binding for an area that is not in the file yet', async () => {
    const selection = selectionOf([
      entity({
        entityId: 'area',
        region: {
          segmentIds: ['segA', 'segB'],
          intersectionIndex: 0,
          intersectionCount: 1,
          clockwise: false,
        },
      }),
    ])

    // The two bordering curves are the two segments inside the sketch block.
    const scene = sceneWith({ segA: [40, 44, 1], segB: [70, 74, 1] })

    const { runner, buffer } = setup({
      sketchBlock: true,
      source: 'triangle = sketch(on = XY) {}\n',
      resolvers: resolverFor(selection, scene),
    })

    await runner.start('modeling.extrude')
    await runner.answer('area')
    await runner.answer('5')

    // The region is bound first and consumed second, in one transaction — and
    // the segments are named the way V2 names them from outside the block.
    expect(buffer.text.value).toBe(
      'triangle = sketch(on = XY) {}\n' +
        'region001 = region(segments = [triangle.line1, triangle.line2])\n' +
        'extrude001 = extrude(region001, length = 5)\n'
    )
    expect(buffer.version.value).toBe(1)
  })

  /**
   * "For a single closed segment such as a circle, pass only that segment" — and
   * a circle is where the engine's walking curve and its intersecting curve are
   * the same one. Writing it twice would be wrong KCL, not merely noisy.
   */
  it('passes one segment when both curves are the same one', async () => {
    const selection = selectionOf([
      entity({
        entityId: 'area',
        region: {
          segmentIds: ['segA', 'segA'],
          intersectionIndex: 0,
          intersectionCount: 1,
          clockwise: false,
        },
      }),
    ])

    const { runner, buffer } = setup({
      sketchBlock: true,
      resolvers: resolverFor(selection, sceneWith({ segA: [40, 44, 1] })),
    })

    await runner.start('modeling.extrude')
    await runner.answer('area')
    await runner.answer('5')

    expect(buffer.text.value).toContain('region(segments = [triangle.line1])')
  })

  it('carries the disambiguators only when they say something', async () => {
    const selection = selectionOf([
      entity({
        entityId: 'area',
        region: {
          segmentIds: ['segA', 'segB'],
          intersectionIndex: 2,
          intersectionCount: 4,
          clockwise: true,
        },
      }),
    ])

    const { runner, buffer } = setup({
      sketchBlock: true,
      resolvers: resolverFor(
        selection,
        sceneWith({ segA: [40, 44, 1], segB: [70, 74, 1] })
      ),
    })

    await runner.start('modeling.extrude')
    await runner.answer('area')
    await runner.answer('5')

    expect(buffer.text.value).toContain('intersectionIndex = 2')
    expect(buffer.text.value).toContain('direction = CW')
  })

  it('leaves nothing behind when a region is cancelled', async () => {
    const selection = selectionOf([
      entity({
        entityId: 'area',
        region: {
          segmentIds: ['segA', 'segB'],
          intersectionIndex: 0,
          intersectionCount: 1,
          clockwise: false,
        },
      }),
    ])

    const { runner, buffer } = setup({
      resolvers: resolverFor(
        selection,
        sceneWith({ segA: [5, 9, 1], segB: [12, 16, 1] })
      ),
    })

    await runner.start('modeling.extrude')
    await runner.answer('area')
    runner.cancel()

    expect(buffer.text.value).not.toContain('region')
  })

  it('contributes nothing for an entity it can neither name nor write', async () => {
    const nowhere = selectionOf([
      entity({ entityId: 'wall', kind: 'wall', sourceRange: [9000, 9010, 1] }),
    ])

    const { runner } = setup({ resolvers: resolverFor(nowhere) })

    await runner.start('modeling.extrude')
    await runner.answer('wall')

    // Nothing to refer to and nothing to write, so the required argument is
    // refused rather than written as an empty reference.
    expect(runner.pending.value?.error).toMatch(/sketches is needed/)
  })
})
