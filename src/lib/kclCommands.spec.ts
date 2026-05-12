import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import {
  addParameterToComponentSource,
  componentKclValueOptionsForAst,
} from '@src/lib/kclCommands'
import { describe, expect, it } from 'vitest'

function rangeOf(code: string, value: string, fromIndex = 0) {
  const start = code.indexOf(value, fromIndex)
  if (start === -1) {
    throw new Error(`Could not find ${value}`)
  }
  return { start, end: start + value.length, valueText: value }
}

function componentAst({
  code,
  componentName,
  params = [],
  values,
}: {
  code: string
  componentName: string
  params?: string[]
  values: Array<{ start: number; end: number; valueText: string }>
}): Node<Program> {
  const componentStart = code.indexOf('component')
  const bodyStart = code.indexOf('{', componentStart) + 1
  const bodyEnd = code.lastIndexOf('}')

  return {
    type: 'Program',
    start: 0,
    end: code.length,
    body: [
      {
        type: 'VariableDeclaration',
        start: code.indexOf(componentName),
        end: bodyEnd + 1,
        declaration: {
          type: 'VariableDeclarator',
          start: code.indexOf(componentName),
          end: bodyEnd + 1,
          id: {
            type: 'Identifier',
            name: componentName,
            start: code.indexOf(componentName),
            end: code.indexOf(componentName) + componentName.length,
          },
          init: {
            type: 'ComponentBlock',
            start: componentStart,
            end: bodyEnd + 1,
            arguments: params.map((param) => ({
              type: 'LabeledArg',
              label: {
                type: 'Identifier',
                name: param,
                start: code.indexOf(param, componentStart),
                end: code.indexOf(param, componentStart) + param.length,
              },
              arg: {
                type: 'Name',
                start: code.indexOf(param, componentStart),
                end: code.indexOf(param, componentStart) + param.length,
              },
            })),
            body: {
              type: 'Block',
              start: bodyStart,
              end: bodyEnd,
              body: values.map((value) => ({
                type: 'ExpressionStatement',
                start: value.start,
                end: value.end,
                expression: {
                  type: value.valueText.startsWith('[')
                    ? 'ArrayExpression'
                    : 'Literal',
                  start: value.start,
                  end: value.end,
                },
              })),
            },
          },
        },
        kind: 'const',
      },
    ],
  } as unknown as Node<Program>
}

describe('component add parameter codemod', () => {
  it('lists values inside a component definition without listing signature defaults', () => {
    const code = `@settings(experimentalFeatures = allow)

mySurfaceLine = component(start = [var -4.3mm, var -2.6mm]) {
  sketch001 = sketch(on = XY) {
    line1 = line(start = start, end = [var -4.3mm, var 0.27mm])
  }
  extrude001 = extrude(sketch001.line1, length = 5, bodyType = SURFACE)
  return extrude001
}
`
    const bodyArray = rangeOf(code, '[var -4.3mm, var 0.27mm]')
    const length = rangeOf(code, '5', code.indexOf('length = 5'))
    const ast = componentAst({
      code,
      componentName: 'mySurfaceLine',
      params: ['start'],
      values: [bodyArray, length],
    })

    const options = componentKclValueOptionsForAst(ast, code, 'mySurfaceLine')

    expect(options.map((option) => option.valueText)).toEqual([
      bodyArray.valueText,
      length.valueText,
    ])
  })

  it('moves a selected body value into an empty component signature', () => {
    const code = `@settings(experimentalFeatures = allow)

mySurfaceLine = component() {
  extrude001 = extrude(length = 5, bodyType = SURFACE)
  return extrude001
}
`
    const length = rangeOf(code, '5', code.indexOf('length = 5'))
    const ast = componentAst({
      code,
      componentName: 'mySurfaceLine',
      values: [length],
    })

    const newCode = addParameterToComponentSource({
      ast,
      code,
      componentName: 'mySurfaceLine',
      value: length,
      parameterName: 'length',
    })

    expect(newCode).not.toBeInstanceOf(Error)
    expect(newCode).toContain('mySurfaceLine = component(length = 5)')
    expect(newCode).toContain('extrude001 = extrude(length = length')
  })

  it('moves a selected body value into a multiline component signature', () => {
    const code = `@settings(experimentalFeatures = allow)

mySurfaceLine = component(
  start = [var -4.3mm, var -2.6mm],
) {
  sketch001 = sketch(on = XY) {
    line1 = line(start = start, end = [var -4.3mm, var 0.27mm])
  }
  extrude001 = extrude(sketch001.line1, length = 5, bodyType = SURFACE)
  return extrude001
}
`
    const length = rangeOf(code, '5', code.indexOf('length = 5'))
    const ast = componentAst({
      code,
      componentName: 'mySurfaceLine',
      params: ['start'],
      values: [length],
    })

    const newCode = addParameterToComponentSource({
      ast,
      code,
      componentName: 'mySurfaceLine',
      value: length,
      parameterName: 'length',
    })

    expect(newCode).not.toBeInstanceOf(Error)
    expect(newCode).toContain(`mySurfaceLine = component(
  start = [var -4.3mm, var -2.6mm],
  length = 5,
)`)
    expect(newCode).toContain(
      'extrude001 = extrude(sketch001.line1, length = length'
    )
  })
})
