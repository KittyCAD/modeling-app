import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import {
  addParameterToComponentSource,
  componentKclValueOptionsForAst,
  createComponentFromSelection,
  deleteParameterFromComponentSource,
  kclCommands,
  renameParameterInComponentSource,
  updateComponentInstanceOverrideSource,
} from '@src/lib/kclCommands'
import { describe, expect, it, vi } from 'vitest'

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

function paramArg(
  code: string,
  label: string,
  value: string,
  fromIndex: number
) {
  const labelStart = code.indexOf(`${label} =`, fromIndex)
  const valueStart = code.indexOf(value, labelStart)
  return {
    type: 'LabeledArg',
    label: {
      type: 'Identifier',
      name: label,
      start: labelStart,
      end: labelStart + label.length,
    },
    arg: {
      type: value.startsWith('[') ? 'ArrayExpression' : 'Literal',
      start: valueStart,
      end: valueStart + value.length,
      elements: [],
    },
  }
}

function nameRef(code: string, source: string, name: string, fromIndex = 0) {
  const sourceStart = code.indexOf(source, fromIndex)
  const sourceRelativeStart = source.lastIndexOf(name)
  const start =
    sourceRelativeStart === -1
      ? code.indexOf(name, sourceStart)
      : sourceStart + sourceRelativeStart
  return {
    type: 'Name',
    start,
    end: start + name.length,
    name: {
      type: 'Identifier',
      name,
      start,
      end: start + name.length,
    },
    path: [],
    abs_path: false,
  }
}

function topLevelVariable(code: string, name: string) {
  const start = code.indexOf(`${name} =`)
  if (start === -1) {
    throw new Error(`Could not find ${name}`)
  }
  const lineEnd = code.indexOf('\n', start)
  const end = lineEnd === -1 ? code.length : lineEnd

  return {
    type: 'VariableDeclaration',
    start,
    end,
    declaration: {
      type: 'VariableDeclarator',
      start,
      end,
      id: {
        type: 'Identifier',
        name,
        start,
        end: start + name.length,
      },
    },
    kind: 'const',
  }
}

function topLevelExpression(code: string, source: string) {
  const start = code.indexOf(source)
  if (start === -1) {
    throw new Error(`Could not find ${source}`)
  }
  const lineEnd = code.indexOf('\n', start)
  const end = lineEnd === -1 ? code.length : lineEnd

  return {
    type: 'ExpressionStatement',
    start,
    end,
  }
}

function componentAstForParameterEdit(code: string): Node<Program> {
  const componentName = 'mySurfaceLine'
  const componentStart = code.indexOf('component')
  const componentBodyStart = code.indexOf('{', componentStart) + 1
  const componentEnd = code.indexOf('\nsurfaceB')
  const callStart = code.indexOf('mySurfaceLine(', componentEnd)
  const callEnd = code.indexOf(')', callStart) + 1
  const callArguments = [
    paramArg(code, 'start', '[var -2mm, var -2.6mm]', callStart),
  ]
  if (code.indexOf('length = 10', callStart) !== -1) {
    callArguments.push(paramArg(code, 'length', '10', callStart))
  }

  return {
    type: 'Program',
    start: 0,
    end: code.length,
    body: [
      {
        type: 'VariableDeclaration',
        start: code.indexOf(componentName),
        end: componentEnd,
        declaration: {
          type: 'VariableDeclarator',
          start: code.indexOf(componentName),
          end: componentEnd,
          id: {
            type: 'Identifier',
            name: componentName,
            start: code.indexOf(componentName),
            end: code.indexOf(componentName) + componentName.length,
          },
          init: {
            type: 'ComponentBlock',
            start: componentStart,
            end: componentEnd,
            arguments: [
              paramArg(
                code,
                'start',
                '[var -4.3mm, var -2.6mm]',
                componentStart
              ),
              paramArg(code, 'length', '5', componentStart),
            ],
            body: {
              type: 'Block',
              start: componentBodyStart,
              end: componentEnd,
              items: [
                nameRef(code, 'start = start', 'start'),
                nameRef(code, 'length = length', 'length'),
              ],
            },
          },
        },
        kind: 'const',
      },
      {
        type: 'VariableDeclaration',
        start: code.indexOf('surfaceB'),
        end: code.length,
        declaration: {
          type: 'VariableDeclarator',
          start: code.indexOf('surfaceB'),
          end: code.length,
          id: {
            type: 'Identifier',
            name: 'surfaceB',
            start: code.indexOf('surfaceB'),
            end: code.indexOf('surfaceB') + 'surfaceB'.length,
          },
          init: {
            type: 'CallExpressionKw',
            start: callStart,
            end: callEnd,
            callee: nameRef(code, 'mySurfaceLine(', componentName, callStart),
            unlabeled: null,
            arguments: callArguments,
          },
        },
        kind: 'const',
      },
    ],
  } as unknown as Node<Program>
}

describe('component create codemod', () => {
  it('wraps intervening top-level statements between discontinuous selections', () => {
    const code = `sketch001 = startSketchOn(XY)
hide(sketch001)
extrude001 = extrude(sketch001, length = 5)
`
    const sketch = topLevelVariable(code, 'sketch001')
    const hide = topLevelExpression(code, 'hide(sketch001)')
    const extrude = topLevelVariable(code, 'extrude001')
    const newCode = createComponentFromSelection(
      {
        ast: {
          type: 'Program',
          start: 0,
          end: code.length,
          body: [sketch, hide, extrude],
        },
        code,
        selectionRanges: {
          graphSelections: [
            { codeRef: { range: [sketch.start, sketch.end, 0] } },
            { codeRef: { range: [extrude.start, extrude.end, 0] } },
          ],
        },
      } as never,
      'myComponent'
    )

    expect(newCode).not.toBeInstanceOf(Error)
    expect(newCode).toContain(`myComponent = component() {
  sketch001 = startSketchOn(XY)
  hide(sketch001)
  extrude001 = extrude(sketch001, length = 5)
  return extrude001
}`)
  })
})

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

describe('Insert command components', () => {
  it('reads component targets from the current AST when an existing command is invoked', async () => {
    const emptyAst = {
      type: 'Program',
      start: 0,
      end: 0,
      body: [],
    } as unknown as Node<Program>
    const kclManager = {
      ast: emptyAst,
      code: '',
      fileSettings: {},
      isExecuting: false,
      safeParse: vi.fn().mockResolvedValue(emptyAst),
      updateCodeEditor: vi.fn(),
      variables: {},
      wasmInstancePromise: Promise.resolve({}),
    }
    const commands = kclCommands({
      authToken: '',
      isRestrictedToOrg: false,
      kclManager: kclManager as never,
      password: undefined,
      project: undefined,
      projectData: { code: '' },
      settings: { defaultUnit: 'mm' },
      specialPropsForInsertCommand: { providedOptions: [] },
      systemIOActor: {
        getSnapshot: () => ({ context: {} }),
      } as never,
      wasmInstance: {} as never,
    })
    const insert = commands.find((command) => command.name === 'Insert')
    if (
      !insert ||
      !insert.args ||
      !('target' in insert.args) ||
      insert.args.target.inputType !== 'options'
    ) {
      throw new Error('Insert command not found')
    }

    const code = `mySurfaceLine = component() {
  extrude001 = extrude(length = 5)
  return extrude001
}
`
    kclManager.code = code
    kclManager.ast = componentAst({
      code,
      componentName: 'mySurfaceLine',
      values: [],
    })

    const options =
      typeof insert.args.target.options === 'function'
        ? insert.args.target.options(
            { argumentsToSubmit: {} } as never,
            undefined
          )
        : insert.args.target.options

    expect(options).toContainEqual({
      name: 'Component: mySurfaceLine',
      value: 'component:mySurfaceLine',
    })

    await insert.onSubmit?.({
      target: 'component:mySurfaceLine',
      localName: 'surfaceB',
    })

    expect(kclManager.updateCodeEditor).toHaveBeenCalledWith(
      `${code.trimEnd()}\nsurfaceB = clone(mySurfaceLine)\n`,
      expect.objectContaining({ shouldExecute: true })
    )
  })
})

describe('Component parameter commands', () => {
  it('reads add-parameter component options from the current AST when an existing command is invoked', async () => {
    const emptyAst = {
      type: 'Program',
      start: 0,
      end: 0,
      body: [],
    } as unknown as Node<Program>
    const kclManager = {
      ast: emptyAst,
      code: '',
      fileSettings: {},
      isExecuting: false,
      safeParse: vi.fn().mockImplementation(async () => kclManager.ast),
      updateCodeEditor: vi.fn(),
      variables: {},
      wasmInstancePromise: Promise.resolve({}),
    }
    const commands = kclCommands({
      authToken: '',
      isRestrictedToOrg: false,
      kclManager: kclManager as never,
      password: undefined,
      project: undefined,
      projectData: { code: '' },
      settings: { defaultUnit: 'mm' },
      specialPropsForInsertCommand: { providedOptions: [] },
      systemIOActor: {
        getSnapshot: () => ({ context: {} }),
      } as never,
      wasmInstance: {} as never,
    })
    const addParameter = commands.find(
      (command) => command.name === 'component.addParameter'
    )
    if (
      !addParameter ||
      !addParameter.args ||
      addParameter.args.componentName.inputType !== 'options' ||
      addParameter.args.value.inputType !== 'options'
    ) {
      throw new Error('Add component parameter command not found')
    }

    const code = `mySurfaceLine = component() {
  extrude001 = extrude(length = 5)
  return extrude001
}
`
    const length = rangeOf(code, '5', code.indexOf('length = 5'))
    kclManager.code = code
    kclManager.ast = componentAst({
      code,
      componentName: 'mySurfaceLine',
      values: [length],
    })

    const componentOptions =
      typeof addParameter.args.componentName.options === 'function'
        ? addParameter.args.componentName.options(
            { argumentsToSubmit: {} } as never,
            undefined
          )
        : addParameter.args.componentName.options
    expect(componentOptions).toContainEqual({
      name: 'mySurfaceLine',
      value: 'mySurfaceLine',
    })

    const valueOptions =
      typeof addParameter.args.value.options === 'function'
        ? addParameter.args.value.options(
            { argumentsToSubmit: { componentName: 'mySurfaceLine' } } as never,
            undefined
          )
        : addParameter.args.value.options
    expect(valueOptions.map((option) => option.value)).toContainEqual(length)

    await addParameter.onSubmit?.({
      componentName: 'mySurfaceLine',
      value: length,
      parameterName: 'length',
    })

    expect(kclManager.updateCodeEditor).toHaveBeenCalledWith(
      expect.stringContaining('mySurfaceLine = component(length = 5)'),
      expect.objectContaining({ shouldExecute: true })
    )
  })
})

describe('component instance override codemod', () => {
  it('updates an existing override value', () => {
    const code = `mySurfaceLine = component(length = 5) {
  extrude001 = extrude(length = length)
  return extrude001
}
surfaceB = mySurfaceLine(length = 10)
`
    const definitionStart = code.indexOf('mySurfaceLine = component')
    const definitionEnd = code.indexOf('\nsurfaceB')
    const call = rangeOf(code, 'mySurfaceLine(length = 10)')
    const override = rangeOf(code, '10', call.start)

    const newCode = updateComponentInstanceOverrideSource({
      code,
      instance: {
        componentName: 'mySurfaceLine',
        isDefault: false,
        sourceRange: [call.start, call.end, 0],
        definitionSourceRange: [definitionStart, definitionEnd, 0],
        labeledArgs: {
          length: {
            sourceRange: [override.start, override.end, 0],
          },
        },
      },
      overrideName: 'length',
      valueText: '15',
    })

    expect(newCode).not.toBeInstanceOf(Error)
    expect(newCode).toContain('surfaceB = mySurfaceLine(length = 15)')
  })

  it('updates a default instance parameter value', () => {
    const code = `mySurfaceLine = component(length = 5) {
  extrude001 = extrude(length = length)
  return extrude001
}
`
    const definitionStart = code.indexOf('mySurfaceLine = component')
    const definitionEnd = code.lastIndexOf('}') + 1
    const defaultValue = rangeOf(code, '5', code.indexOf('length = 5'))

    const newCode = updateComponentInstanceOverrideSource({
      code,
      instance: {
        componentName: 'mySurfaceLine',
        isDefault: true,
        sourceRange: [definitionStart, definitionEnd, 0],
        definitionSourceRange: [definitionStart, definitionEnd, 0],
        labeledArgs: {
          length: {
            sourceRange: [defaultValue.start, defaultValue.end, 0],
          },
        },
      },
      overrideName: 'length',
      valueText: '10',
    })

    expect(newCode).not.toBeInstanceOf(Error)
    expect(newCode).toContain('mySurfaceLine = component(length = 10)')
  })
})

describe('component parameter edit codemods', () => {
  it('renames a parameter in the signature, direct body references, and override calls', () => {
    const code = `@settings(experimentalFeatures = allow)

mySurfaceLine = component(start = [var -4.3mm, var -2.6mm], length = 5) {
  sketch001 = sketch(on = XY) {
    line1 = line(start = start, end = [var -4.3mm, var 0.27mm])
  }
  extrude001 = extrude(sketch001.line1, length = length, bodyType = SURFACE)
  return extrude001
}
surfaceB = mySurfaceLine(start = [var -2mm, var -2.6mm], length = 10)
`
    const ast = componentAstForParameterEdit(code)

    const newCode = renameParameterInComponentSource({
      ast,
      code,
      componentName: 'mySurfaceLine',
      parameterName: 'start',
      newParameterName: 'origin',
    })

    expect(newCode).not.toBeInstanceOf(Error)
    expect(newCode).toContain(
      'component(origin = [var -4.3mm, var -2.6mm], length = 5)'
    )
    expect(newCode).toContain('line1 = line(start = origin, end =')
    expect(newCode).toContain(
      'surfaceB = mySurfaceLine(origin = [var -2mm, var -2.6mm], length = 10)'
    )
  })

  it('deletes a parameter by inlining defaults and removing override args', () => {
    const code = `@settings(experimentalFeatures = allow)

mySurfaceLine = component(start = [var -4.3mm, var -2.6mm], length = 5) {
  sketch001 = sketch(on = XY) {
    line1 = line(start = start, end = [var -4.3mm, var 0.27mm])
  }
  extrude001 = extrude(sketch001.line1, length = length, bodyType = SURFACE)
  return extrude001
}
surfaceB = mySurfaceLine(start = [var -2mm, var -2.6mm], length = 10)
`
    const ast = componentAstForParameterEdit(code)

    const newCode = deleteParameterFromComponentSource({
      ast,
      code,
      componentName: 'mySurfaceLine',
      parameterName: 'start',
    })

    expect(newCode).not.toBeInstanceOf(Error)
    expect(newCode).toContain('mySurfaceLine = component(length = 5)')
    expect(newCode).toContain(
      'line1 = line(start = [var -4.3mm, var -2.6mm], end ='
    )
    expect(newCode).toContain('surfaceB = mySurfaceLine(length = 10)')
  })

  it('converts an override call to clone when deleting its only override arg', () => {
    const code = `@settings(experimentalFeatures = allow)

mySurfaceLine = component(start = [var -4.3mm, var -2.6mm], length = 5) {
  sketch001 = sketch(on = XY) {
    line1 = line(start = start, end = [var -4.3mm, var 0.27mm])
  }
  extrude001 = extrude(sketch001.line1, length = length, bodyType = SURFACE)
  return extrude001
}
surfaceB = mySurfaceLine(start = [var -2mm, var -2.6mm])
`
    const ast = componentAstForParameterEdit(code)

    const newCode = deleteParameterFromComponentSource({
      ast,
      code,
      componentName: 'mySurfaceLine',
      parameterName: 'start',
    })

    expect(newCode).not.toBeInstanceOf(Error)
    expect(newCode).toContain('surfaceB = clone(mySurfaceLine)')
  })
})
