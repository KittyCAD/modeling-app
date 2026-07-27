import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLocalName,
} from '@src/lang/create'
import { pathsReferToSamePipe, replaceCallInPlace } from '@src/lang/modifyAst'
import type { PathToNode } from '@src/lang/wasm'
import { describe, expect, it } from 'vitest'

describe('editing calls in place', () => {
  it('preserves an existing unlabeled argument when reconstruction fails', () => {
    const inlineInput = createCallExpressionStdLibKw(
      'extrude',
      createLocalName('profile'),
      []
    )
    const existingCall = createCallExpressionStdLibKw(
      'translate',
      inlineInput,
      [createLabeledArg('x', createLocalName('oldX'))]
    )
    const replacementCall = createCallExpressionStdLibKw('translate', null, [
      createLabeledArg('x', createLocalName('newX')),
    ])

    replaceCallInPlace(existingCall, replacementCall)

    expect(existingCall.unlabeled).toEqual(inlineInput)
    expect(existingCall.arguments).toEqual(replacementCall.arguments)
    expect(replacementCall.unlabeled).toBeNull()
  })

  it('uses a reconstructed unlabeled argument when available', () => {
    const existingCall = createCallExpressionStdLibKw(
      'translate',
      createLocalName('oldBody'),
      []
    )
    const replacementInput = createLocalName('newBody')
    const replacementCall = createCallExpressionStdLibKw(
      'translate',
      replacementInput,
      []
    )

    replaceCallInPlace(existingCall, replacementCall)

    expect(existingCall.unlabeled).toEqual(replacementInput)
  })

  it('recognizes different calls in the same pipe', () => {
    const first: PathToNode = [
      ['body', ''],
      [0, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
      ['body', 'PipeExpression'],
      [1, 'index'],
    ]
    const second: PathToNode = [...first.slice(0, -1), [2, 'index']]

    expect(pathsReferToSamePipe(first, second)).toBe(true)
  })

  it('rejects paths from different pipes', () => {
    const first: PathToNode = [
      ['body', ''],
      [0, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
      ['body', 'PipeExpression'],
      [1, 'index'],
    ]
    const second: PathToNode = [
      ['body', ''],
      [1, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
      ['body', 'PipeExpression'],
      [1, 'index'],
    ]

    expect(pathsReferToSamePipe(first, second)).toBe(false)
  })
})
