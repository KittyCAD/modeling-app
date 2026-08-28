import type { Program } from '@rust/kcl-lib/bindings/Program'
import { sourceOutlineAfter } from '@src/features/featureTree/sourceOutline'
import { describe, expect, it } from 'vitest'

const node = { moduleId: 0, commentStart: 0 }

describe('source feature outline', () => {
  it('shows parsed operations after the execution boundary as unbuilt rows', () => {
    const source =
      'profile = startSketchOn(XY)\n' +
      'exit()\n' +
      'solid = extrude(profile, length = 10)\n' +
      'radius = 2\n'
    const extrudeStatement = source.indexOf('solid =')
    const extrudeCall = source.indexOf('extrude(')
    const extrudeEnd = source.indexOf(')', extrudeCall) + 1
    const radius = source.indexOf('radius =')
    const program = {
      body: [
        {
          ...node,
          type: 'ExpressionStatement',
          start: source.indexOf('exit()'),
          end: source.indexOf('exit()') + 6,
          expression: {
            ...node,
            type: 'CallExpressionKw',
            start: source.indexOf('exit()'),
            end: source.indexOf('exit()') + 6,
            callee: {
              ...node,
              type: 'Name',
              name: { ...node, type: 'Identifier', name: 'exit' },
              path: [],
              abs_path: false,
            },
            unlabeled: null,
            arguments: [],
          },
        },
        {
          ...node,
          type: 'VariableDeclaration',
          start: extrudeStatement,
          end: extrudeEnd,
          kind: 'const',
          declaration: {
            ...node,
            type: 'VariableDeclarator',
            id: { ...node, type: 'Identifier', name: 'solid' },
            init: {
              ...node,
              type: 'CallExpressionKw',
              start: extrudeCall,
              end: extrudeEnd,
              callee: {
                ...node,
                type: 'Name',
                name: { ...node, type: 'Identifier', name: 'extrude' },
                path: [],
                abs_path: false,
              },
              unlabeled: null,
              arguments: [],
            },
          },
        },
        {
          ...node,
          type: 'VariableDeclaration',
          start: radius,
          end: source.length - 1,
          kind: 'const',
          declaration: {
            ...node,
            type: 'VariableDeclarator',
            id: { ...node, type: 'Identifier', name: 'radius' },
            init: {
              ...node,
              type: 'Literal',
              start: source.indexOf('2', radius),
              end: source.indexOf('2', radius) + 1,
              value: { type: 'Number', value: 2, suffix: null },
              raw: '2',
            },
          },
        },
      ],
    } as unknown as Program

    const rows = sourceOutlineAfter(source, program, source.indexOf('exit()'))
    expect(rows.map(({ label, kind }) => [label, kind])).toEqual([
      ['Extrude', 'Operation'],
      ['radius', 'Parameter'],
    ])
    expect(rows[0].rollbackInsertion).toBe(extrudeStatement)
  })
})
