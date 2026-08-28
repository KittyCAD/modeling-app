import type { Program } from '@rust/kcl-lib/bindings/Program'
import { computed, signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { combineCapabilities } from '@src/contracts/buffers'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import type {
  ArgumentResolver,
  ModelingOperation,
} from '@src/contracts/modelingOperations'
import type { ProjectSession } from '@src/contracts/projectSession'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { createOperationRunner } from '@src/features/modelingOperations/createOperationRunner'
import { extrudeOperation } from '@src/features/modelingOperations/operations/extrude'
import { builtInResolvers } from '@src/features/modelingOperations/resolvers'
import { namedTypesIn } from '@src/lib/kclStdlib/types'

/**
 * A program with the bindings a test cares about.
 *
 * Hand-built rather than parsed, because the runner takes `parse` as a
 * dependency precisely so a test does not need fifteen megabytes of WebAssembly
 * to answer a question about argument order.
 */
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
      ast: programWith(
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

  it('says so when the file has nothing to extrude', async () => {
    const { runner } = setup({ bindings: [] })

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
      // `method` is a string, and nothing handles strings yet.
      annotations: { prompt: ['method'] },
    }

    const { runner } = setup({ operations: [operation] })

    await runner.start('modeling.exotic')
    await runner.answer('profile001')

    expect(runner.pending.value).toBeNull()
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
