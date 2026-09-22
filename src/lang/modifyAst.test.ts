import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLocalName,
} from '@src/lang/create'
import { pathsReferToSamePipe, replaceCallInPlace } from '@src/lang/modifyAst'
import type { PathToNode } from '@src/lang/wasm'
import { describe, expect, it } from 'vitest'

describe('editing calls in place', () => {
  it('preserves an existing unlabeled argument when the edit omits it', () => {
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

  it('ignores a replacement unlabeled argument', () => {
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

    expect(existingCall.unlabeled).toEqual(createLocalName('oldBody'))
  })

  it('preserves labeled selection arguments and applies other edits', () => {
    const existingCall = createCallExpressionStdLibKw(
      'split',
      createLocalName('target'),
      [
        createLabeledArg('tools', createLocalName('oldTool')),
        createLabeledArg('merge', createLocalName('oldMerge')),
      ]
    )
    const replacementMerge = createLabeledArg(
      'merge',
      createLocalName('newMerge')
    )
    const replacementCall = createCallExpressionStdLibKw(
      'split',
      createLocalName('differentTarget'),
      [replacementMerge]
    )

    replaceCallInPlace(existingCall, replacementCall, ['tools'])

    expect(existingCall.unlabeled).toEqual(createLocalName('target'))
    expect(existingCall.arguments).toEqual([
      createLabeledArg('tools', createLocalName('oldTool')),
      replacementMerge,
    ])
  })

  it('ignores a replacement labeled selection argument', () => {
    const existingTool = createLabeledArg('tools', createLocalName('oldTool'))
    const existingCall = createCallExpressionStdLibKw(
      'subtract',
      createLocalName('target'),
      [existingTool]
    )
    const replacementCall = createCallExpressionStdLibKw(
      'subtract',
      createLocalName('differentTarget'),
      [createLabeledArg('tools', createLocalName('differentTool'))]
    )

    replaceCallInPlace(existingCall, replacementCall, ['tools'])

    expect(existingCall.arguments).toEqual([existingTool])
  })

  it('ignores a reconstructed labeled selection that did not exist', () => {
    const existingCall = createCallExpressionStdLibKw(
      'extrude',
      createLocalName('profile'),
      [createLabeledArg('length', createLocalName('oldLength'))]
    )
    const replacementLength = createLabeledArg(
      'length',
      createLocalName('newLength')
    )
    const replacementCall = createCallExpressionStdLibKw(
      'extrude',
      createLocalName('differentProfile'),
      [
        replacementLength,
        createLabeledArg('direction', createLocalName('rebuiltDirection')),
      ]
    )

    replaceCallInPlace(existingCall, replacementCall, ['direction'])

    expect(existingCall.arguments).toEqual([replacementLength])
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

  it('rejects identical paths that are not inside a pipe', () => {
    const path: PathToNode = [
      ['body', ''],
      [0, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
    ]

    expect(pathsReferToSamePipe(path, path)).toBe(false)
  })
})
