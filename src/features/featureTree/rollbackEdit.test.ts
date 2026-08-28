import { ChangeSet, Text } from '@codemirror/state'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import {
  editableFeatureFor,
  rollbackBeforeFeature,
  rollbackExitRange,
} from '@src/features/featureTree/rollbackEdit'
import { operationFor } from '@src/features/modelingOperations/operations/catalog'
import { describe, expect, it } from 'vitest'

const node = { moduleId: 0, commentStart: 0 }

function directCallFixture(source: string) {
  const statementFrom = source.indexOf('solid =')
  const statementTo = source.indexOf('\n', statementFrom)
  const callFrom = source.indexOf('extrude(', statementFrom)
  const callTo = source.indexOf(')', callFrom) + 1
  const profileFrom = source.indexOf('profile', callFrom)
  const lengthFrom = source.indexOf('10', callFrom)

  const program = {
    body: [
      {
        ...node,
        type: 'VariableDeclaration',
        start: statementFrom,
        end: statementTo,
        kind: 'const',
        declaration: {
          ...node,
          type: 'VariableDeclarator',
          start: statementFrom,
          end: statementTo,
          id: { ...node, type: 'Identifier', name: 'solid' },
          init: {
            ...node,
            type: 'CallExpressionKw',
            start: callFrom,
            end: callTo,
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
    ],
  } as unknown as Program

  const operation = {
    type: 'StdLibCall',
    name: 'extrude',
    unlabeledArg: {
      value: { type: 'Sketch', value: { artifactId: 'profile' } },
      sourceRange: [profileFrom, profileFrom + 'profile'.length, 0],
    },
    labeledArgs: {
      length: {
        value: { type: 'Number', value: 10, ty: { type: 'Unknown' } },
        sourceRange: [lengthFrom, lengthFrom + 2, 0],
      },
      ...(source.includes('symmetric = true')
        ? {
            symmetric: {
              value: { type: 'Bool', value: true },
              sourceRange: [
                source.indexOf('true', callFrom),
                source.indexOf('true', callFrom) + 4,
                0,
              ],
            },
          }
        : {}),
    },
    nodePath: { steps: [] },
    sourceRange: [callFrom, callTo, 0],
  } as Operation

  return { program, operation }
}

describe('source-backed feature rollback', () => {
  it('reads current arguments and writes exit before a direct root call', () => {
    const source =
      '@settings(defaultLengthUnit = mm)\n' +
      'profile = startSketchOn(XY)\n' +
      'solid = extrude(profile, length = 10, symmetric = true)\n' +
      'later = fillet(solid, radius = 2)\n'
    const { program, operation } = directCallFixture(source)
    const feature = editableFeatureFor(
      source,
      program,
      operation,
      operationFor('extrude')
    )

    expect(feature?.answers).toEqual({ sketches: 'profile', length: '10' })
    expect(feature?.preservedArguments).toEqual(['symmetric = true'])
    expect(feature).not.toBeNull()
    if (!feature) {
      throw new Error('Expected a direct call to be editable.')
    }

    const rollback = rollbackBeforeFeature(source, feature)
    const next = ChangeSet.of(rollback.changes, source.length)
      .apply(Text.of(source.split('\n')))
      .toString()

    expect(next).toContain(
      '@settings(defaultLengthUnit = mm, experimentalFeatures = allow)'
    )
    expect(next).toContain(
      'exit()\nsolid = extrude(profile, length = 10, symmetric = true)'
    )
    expect(next.slice(rollback.target.call.from, rollback.target.call.to)).toBe(
      'extrude(profile, length = 10, symmetric = true)'
    )
    expect(rollbackExitRange(next)).toEqual(rollback.target.rollback)
  })

  it('moves an existing rollback boundary without adding another one', () => {
    const source =
      '@settings(experimentalFeatures = allow)\n' +
      'profile = startSketchOn(XY)\n' +
      'solid = extrude(profile, length = 10)\n' +
      'exit()\n' +
      'later = fillet(solid, radius = 2)\n'
    const { program, operation } = directCallFixture(source)
    const feature = editableFeatureFor(
      source,
      program,
      operation,
      operationFor('extrude')
    )
    if (!feature) {
      throw new Error('Expected a direct call to be editable.')
    }
    const rollback = rollbackBeforeFeature(source, feature)
    const next = ChangeSet.of(rollback.changes, source.length)
      .apply(Text.of(source.split('\n')))
      .toString()

    expect(next.match(/^exit\(\)$/gm)).toHaveLength(1)
    expect(next.indexOf('exit()')).toBeLessThan(next.indexOf('solid ='))
  })

  it('does not offer a pipeline stage as a root rollback target', () => {
    const source = 'part = sketch() |> extrude(length = 10)\n'
    const callFrom = source.indexOf('extrude')
    const callTo = source.indexOf(')', callFrom) + 1
    const operation = {
      type: 'StdLibCall',
      name: 'extrude',
      unlabeledArg: null,
      labeledArgs: {},
      nodePath: { steps: [] },
      sourceRange: [callFrom, callTo, 0],
    } as Operation
    const program = {
      body: [
        {
          ...node,
          type: 'VariableDeclaration',
          start: 0,
          end: source.length - 1,
          kind: 'const',
          declaration: {
            ...node,
            type: 'VariableDeclarator',
            id: { ...node, type: 'Identifier', name: 'part' },
            init: {
              ...node,
              type: 'PipeExpression',
              start: source.indexOf('sketch'),
              end: source.length - 1,
              body: [],
            },
          },
        },
      ],
    } as unknown as Program

    expect(
      editableFeatureFor(source, program, operation, operationFor('extrude'))
    ).toBeNull()
  })
})
