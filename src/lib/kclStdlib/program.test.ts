import type { Program } from '@rust/kcl-lib/bindings/Program'
import { describe, expect, it } from 'vitest'
import {
  bindingsProducing,
  boundNames,
  freeName,
  referenceAt,
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
