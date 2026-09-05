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

  it('preserves an existing unlabeled argument when reconstruction differs', () => {
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

  it('uses an equivalent reconstructed unlabeled argument', () => {
    const existingInput = createLocalName('body')
    existingInput.start = 10
    existingInput.end = 14
    existingInput.name.start = 10
    existingInput.name.end = 14
    const existingCall = createCallExpressionStdLibKw(
      'translate',
      existingInput,
      [createLabeledArg('x', createLocalName('oldX'))]
    )
    const replacementInput = createLocalName('body')
    const replacementCall = createCallExpressionStdLibKw(
      'translate',
      replacementInput,
      [createLabeledArg('x', createLocalName('newX'))]
    )

    replaceCallInPlace(existingCall, replacementCall)

    expect(existingCall.unlabeled).toBe(replacementInput)
    expect(existingCall.arguments).toEqual(replacementCall.arguments)
  })

  it('preserves changed, removed, and added labeled selection arguments', () => {
    const existingTools = createLabeledArg(
      'tools',
      createLocalName('existingTools')
    )
    const existingDirection = createLabeledArg(
      'direction',
      createLocalName('existingDirection')
    )
    const replacementMerge = createLabeledArg(
      'merge',
      createLocalName('replacementMerge')
    )
    const existingCall = createCallExpressionStdLibKw('split', null, [
      existingTools,
      existingDirection,
      createLabeledArg('merge', createLocalName('existingMerge')),
    ])
    const replacementCall = createCallExpressionStdLibKw('split', null, [
      createLabeledArg('tools', createLocalName('differentTools')),
      createLabeledArg('to', createLocalName('addedTarget')),
      replacementMerge,
    ])

    replaceCallInPlace(existingCall, replacementCall, [
      'tools',
      'direction',
      'to',
    ])

    expect(
      existingCall.arguments.find((arg) => arg.label?.name === 'tools')
    ).toEqual(existingTools)
    expect(
      existingCall.arguments.find((arg) => arg.label?.name === 'direction')
    ).toEqual(existingDirection)
    expect(
      existingCall.arguments.find((arg) => arg.label?.name === 'to')
    ).toBeUndefined()
    expect(
      existingCall.arguments.find((arg) => arg.label?.name === 'merge')
    ).toBe(replacementMerge)
  })

  it('uses an equivalent reconstructed labeled selection argument', () => {
    const existingSelection = createLocalName('tool')
    existingSelection.start = 10
    existingSelection.end = 14
    existingSelection.name.start = 10
    existingSelection.name.end = 14
    const existingCall = createCallExpressionStdLibKw('split', null, [
      createLabeledArg('tools', existingSelection),
    ])
    const replacementSelection = createLabeledArg(
      'tools',
      createLocalName('tool')
    )
    const replacementCall = createCallExpressionStdLibKw('split', null, [
      replacementSelection,
    ])

    replaceCallInPlace(existingCall, replacementCall, ['tools'])

    expect(existingCall.arguments[0]).toBe(replacementSelection)
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
