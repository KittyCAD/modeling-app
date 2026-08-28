import type { Program } from '@rust/kcl-lib/bindings/Program'
import { describe, expect, it } from 'vitest'
import {
  bindingsProducing,
  boundNames,
  freeName,
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
