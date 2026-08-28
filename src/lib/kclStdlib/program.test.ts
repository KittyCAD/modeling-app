import type { Program } from '@rust/kcl-lib/bindings/Program'
import { describe, expect, it } from 'vitest'
import {
  bindingsProducing,
  boundNames,
  freeName,
  referenceAt,
  referencePartsAt,
  sketchBlockAt,
  regionNameAt,
} from '@src/lib/kclStdlib/program'

const node = { start: 0, end: 0, moduleId: 0, commentStart: 0 }

const call = (callee: string) => ({
  ...node,
  type: 'CallExpressionKw',
  unlabeled: null,
  arguments: [],
  callee: {
    ...node,
    type: 'Name',
    abs_path: false,
    path: [],
    name: { ...node, type: 'Identifier', name: callee },
  },
})

const declare = (name: string, init: unknown, at = 0) =>
  ({
    ...node,
    type: 'VariableDeclaration',
    start: at,
    end: at + 30,
    kind: 'const',
    declaration: {
      ...node,
      type: 'VariableDeclarator',
      id: { ...node, type: 'Identifier', name },
      init,
    },
  }) as unknown

const program = (...body: unknown[]) => ({ body }) as unknown as Program

describe('reading a program', () => {
  it('finds a binding whose call returns the wanted type', () => {
    const found = bindingsProducing(
      program(declare('profile001', call('startProfile'))),
      'Sketch'
    )

    expect(found).toEqual([
      { name: 'profile001', via: 'startProfile', from: 0, to: 30 },
    ])
  })

  /** The value of a pipeline is whatever its last stage returned. */
  it('follows a pipeline to its last stage', () => {
    const pipeline = {
      ...node,
      type: 'PipeExpression',
      body: [call('startProfile'), call('line'), call('close')],
    }

    const found = bindingsProducing(
      program(declare('profile001', pipeline)),
      'Sketch'
    )
    expect(found.map((entry) => entry.via)).toEqual(['close'])
  })

  /** The V2 syntax produces a sketch without calling anything. */
  it('understands a sketch block', () => {
    const block = { ...node, type: 'SketchBlock', arguments: [], body: node }
    const found = bindingsProducing(program(declare('s', block)), 'Sketch')

    expect(found.map((entry) => entry.via)).toEqual(['sketch'])
  })

  it('ignores a binding that produces something else', () => {
    const body = program(
      declare('profile001', call('startProfile')),
      declare('thickness', call('abs'), 40)
    )

    expect(bindingsProducing(body, 'Sketch').map((e) => e.name)).toEqual([
      'profile001',
    ])
  })

  /**
   * Derived from the shapes, not from a list of names: a function is a sketch
   * producer because kcl-lib says it returns one.
   */
  it('accepts any stdlib function that returns the type', () => {
    const found = bindingsProducing(
      program(declare('c', call('circle'))),
      'Sketch'
    )
    expect(found.map((entry) => entry.via)).toEqual(['circle'])
  })

  it('says nothing about a function it has never heard of', () => {
    expect(
      bindingsProducing(program(declare('x', call('myHelper'))), 'Sketch')
    ).toEqual([])
  })
})

describe('naming a result', () => {
  it('lists the names already taken', () => {
    const names = boundNames(
      program(declare('a', call('circle')), declare('b', call('circle'), 40))
    )
    expect([...names]).toEqual(['a', 'b'])
  })

  it('numbers from one, padded to three, as the docs do', () => {
    expect(freeName(program(), 'extrude')).toBe('extrude001')
  })

  it('skips the numbers in use', () => {
    const body = program(
      declare('extrude001', call('extrude')),
      declare('extrude002', call('extrude'), 40)
    )
    expect(freeName(body, 'extrude')).toBe('extrude003')
  })
})

describe('referring to what is at an offset', () => {
  it('names a top-level binding', () => {
    const body = program(declare('profile001', call('startProfile')))
    expect(referenceAt(body, 10)).toBe('profile001')
  })

  /**
   * How V2 refers to a segment from outside its sketch block, and what a
   * region's `segments` argument is made of.
   */
  it('names a segment inside a sketch block by its path', () => {
    const inner = (name: string, start: number, end: number) => ({
      ...node,
      type: 'VariableDeclaration',
      start,
      end,
      kind: 'const',
      declaration: {
        ...node,
        type: 'VariableDeclarator',
        id: { ...node, type: 'Identifier', name },
        init: call('line'),
      },
    })

    const body = program({
      ...node,
      type: 'VariableDeclaration',
      start: 0,
      end: 100,
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
            items: [inner('line1', 30, 60), inner('line2', 61, 95)],
          },
        },
      },
    })

    expect(referenceAt(body, 45)).toBe('triangle.line1')
    expect(referenceAt(body, 70)).toBe('triangle.line2')
  })

  it('names the block itself for something between its bindings', () => {
    const body = program({
      ...node,
      type: 'VariableDeclaration',
      start: 0,
      end: 100,
      kind: 'const',
      declaration: {
        ...node,
        type: 'VariableDeclarator',
        id: { ...node, type: 'Identifier', name: 'triangle' },
        init: {
          ...node,
          type: 'SketchBlock',
          arguments: [],
          body: { ...node, type: 'Block', items: [] },
        },
      },
    })

    // A constraint, or the block's own arguments: the block is the honest answer.
    expect(referenceAt(body, 20)).toBe('triangle')
  })

  it('has nothing to say about an offset in no binding', () => {
    expect(referenceAt(program(), 10)).toBeNull()
  })
})

describe('finding the sketch an offset is in', () => {
  const sketchBlock = (name: string, start: number, end: number) =>
    ({
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
          type: 'SketchBlock',
          arguments: [],
          body: { ...node, type: 'Block', items: [] },
        },
      },
    }) as unknown

  it('names the sketch block containing the offset', () => {
    const body = program(sketchBlock('triangle', 0, 100))

    expect(sketchBlockAt(body, 40)).toEqual({
      name: 'triangle',
      from: 0,
      to: 100,
    })
  })

  /* A cursor on `triangle = sketch(XY) {` is in the sketch by any useful test. */
  it('counts the whole statement, not only the braces', () => {
    const body = program(sketchBlock('triangle', 10, 100))

    expect(sketchBlockAt(body, 10)?.name).toBe('triangle')
    expect(sketchBlockAt(body, 100)?.name).toBe('triangle')
  })

  it('finds nothing outside every block', () => {
    const body = program(sketchBlock('triangle', 0, 100))

    expect(sketchBlockAt(body, 101)).toBeNull()
  })

  it('ignores a binding that is not a sketch block', () => {
    const body = program(declare('extrude001', call('extrude'), 0))

    expect(sketchBlockAt(body, 10)).toBeNull()
  })

  it('picks the right one of several', () => {
    const body = program(
      sketchBlock('first', 0, 50),
      sketchBlock('second', 51, 120)
    )

    expect(sketchBlockAt(body, 60)?.name).toBe('second')
  })

  it('finds nothing in an empty program', () => {
    expect(sketchBlockAt(program(), 0)).toBeNull()
  })
})

describe('the region a binding is', () => {
  const named = (value: string) => ({
    ...node,
    type: 'Name',
    abs_path: false,
    path: [],
    name: { ...node, type: 'Identifier', name: value },
  })

  const callWith = (callee: string, unlabeled: unknown = null) => ({
    ...node,
    type: 'CallExpressionKw',
    unlabeled,
    arguments: [],
    callee: named(callee),
  })

  const at = (start: number, end: number, body: unknown) => {
    const declaration = body as { start: number; end: number }
    declaration.start = start
    declaration.end = end
    return declaration
  }

  /*
   * Asked of the segment's own offset rather than worked out from how the sweep
   * was written, because a region's segments carry the range of the `region(…)`
   * call — which is the one thing that is true however the sweep reads.
   */
  it('names the region an offset sits in', () => {
    const body = program(at(0, 50, declare('region001', callWith('region'), 0)))

    expect(regionNameAt(body, 20)).toBe('region001')
  })

  it('says nothing for a binding that is not a region', () => {
    const body = program(at(0, 50, declare('s', callWith('sketch'), 0)))

    expect(regionNameAt(body, 20)).toBeNull()
  })

  it('says nothing outside every binding', () => {
    const body = program(at(0, 50, declare('region001', callWith('region'), 0)))

    expect(regionNameAt(body, 99)).toBeNull()
  })

  it('says nothing for a binding that is not a call at all', () => {
    const body = program(at(0, 50, declare('x', named('y'), 0)))

    expect(regionNameAt(body, 20)).toBeNull()
  })
})

describe('naming what is at an offset, in parts', () => {
  it('splits a segment inside a sketch block from the block', () => {
    const inner = (name: string, start: number, end: number) => ({
      ...node,
      type: 'VariableDeclaration',
      start,
      end,
      kind: 'const',
      declaration: {
        ...node,
        type: 'VariableDeclarator',
        id: { ...node, type: 'Identifier', name },
        init: call('line'),
      },
    })

    const body = program({
      ...node,
      type: 'VariableDeclaration',
      start: 0,
      end: 100,
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
            items: [inner('line1', 30, 60)],
          },
        },
      },
    })

    expect(referencePartsAt(body, 40)).toEqual({
      outer: 'triangle',
      inner: 'line1',
    })
    // The joined form is what a region's `segments` list is made of.
    expect(referenceAt(body, 40)).toBe('triangle.line1')
  })

  it('has no inner part for a plain binding', () => {
    const body = program(declare('extrude001', call('extrude')))

    expect(referencePartsAt(body, 10)).toEqual({ outer: 'extrude001' })
  })
})
