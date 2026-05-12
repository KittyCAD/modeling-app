import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import { rewriteComponentParameterSketchSolveSource } from '@src/machines/sketchSolve/componentParameterWriteback'
import { describe, expect, test } from 'vitest'

const emptyNodePath = { steps: [] }
const value = { type: 'KclNone' } as const

function sourceRange(code: string, source: string, from = 0) {
  const start = code.indexOf(source, from)
  if (start < 0) throw new Error(`Could not find ${source}`)
  return [start, start + source.length, 0] as [number, number, number]
}

function makeAst(code: string): Node<Program> {
  const componentStart = code.indexOf('component(')
  const componentEnd = code.indexOf('\nsurfaceB')
  const defaultRange = sourceRange(code, '[var -4.3mm, var -2.6mm]')
  const bodyStart = code.indexOf('{', componentStart)
  const bodyEnd = code.lastIndexOf('}', componentEnd)
  const paramRefStart = code.indexOf('start = start') + 'start = '.length
  const paramRefEnd = paramRefStart + 'start'.length

  return {
    type: 'Program',
    start: 0,
    end: code.length,
    body: [
      {
        type: 'VariableDeclaration',
        start: 0,
        end: componentEnd,
        kind: 'Const',
        visibility: 'Default',
        declaration: {
          type: 'VariableDeclarator',
          start: 0,
          end: componentEnd,
          id: {
            type: 'Identifier',
            name: 'mySurfaceLine',
            start: 0,
            end: 'mySurfaceLine'.length,
          },
          init: {
            type: 'ComponentBlock',
            start: componentStart,
            end: componentEnd,
            arguments: [
              {
                type: 'LabeledArg',
                label: {
                  type: 'Identifier',
                  name: 'start',
                  start: code.indexOf('start ='),
                  end: code.indexOf('start =') + 'start'.length,
                },
                arg: {
                  type: 'ArrayExpression',
                  start: defaultRange[0],
                  end: defaultRange[1],
                  elements: [],
                },
              },
            ],
            body: {
              type: 'Block',
              start: bodyStart,
              end: bodyEnd,
              items: [
                {
                  type: 'Name',
                  start: paramRefStart,
                  end: paramRefEnd,
                  name: {
                    type: 'Identifier',
                    name: 'start',
                    start: paramRefStart,
                    end: paramRefEnd,
                  },
                  path: [],
                  abs_path: false,
                },
              ],
            },
          },
        },
      },
    ],
  } as unknown as Node<Program>
}

function componentInstance({
  code,
  sketchId,
  isDefault,
  callSource,
  argSource,
}: {
  code: string
  sketchId: number
  isDefault: boolean
  callSource: string
  argSource: string
}): Operation[] {
  const componentRange = sourceRange(
    code,
    code.slice(code.indexOf('component('), code.indexOf('\nsurfaceB'))
  )
  return [
    {
      type: 'GroupBegin',
      sourceRange: sourceRange(code, callSource),
      nodePath: emptyNodePath,
      group: {
        type: 'ComponentInstance',
        name: 'mySurfaceLine',
        definitionSourceRange: componentRange,
        isDefault,
        labeledArgs: {
          start: {
            value,
            sourceRange: sourceRange(code, argSource),
          },
        },
      },
    },
    {
      type: 'SketchSolve',
      sketchId,
      nodePath: emptyNodePath,
      sourceRange: sourceRange(code, 'sketch001 = sketch(on = XY)'),
    },
    { type: 'GroupEnd' },
  ] as Operation[]
}

function editDirectStartReference(code: string, nextValue: string) {
  const reference = sourceRange(code, 'start = start')
  const valueStart = reference[0] + 'start = '.length
  return (
    code.slice(0, valueStart) +
    nextValue +
    code.slice(valueStart + 'start'.length)
  )
}

describe('rewriteComponentParameterSketchSolveSource', () => {
  test('redirects a default instance direct parameter edit to the component signature default', () => {
    const code = `mySurfaceLine = component(start = [var -4.3mm, var -2.6mm]) {
  sketch001 = sketch(on = XY) {
    line1 = line(start = start, end = [var -4.3mm, var 0.27mm])
  }
  return sketch001
}
surfaceB = mySurfaceLine(start = [var -2mm, var -2.6mm])`
    const nextValue = '[var -1mm, var -2mm]'

    const rewritten = rewriteComponentParameterSketchSolveSource({
      ast: makeAst(code),
      code,
      editedCode: editDirectStartReference(code, nextValue),
      operations: componentInstance({
        code,
        sketchId: 7,
        isDefault: true,
        callSource:
          'component(start = [var -4.3mm, var -2.6mm]) {\n  sketch001 = sketch(on = XY) {\n    line1 = line(start = start, end = [var -4.3mm, var 0.27mm])\n  }\n  return sketch001\n}',
        argSource: '[var -4.3mm, var -2.6mm]',
      }),
      sketchId: 7,
    })

    expect(rewritten).toContain('component(start = [var -1mm, var -2mm])')
    expect(rewritten).toContain('line1 = line(start = start, end =')
    expect(rewritten).toContain(
      'surfaceB = mySurfaceLine(start = [var -2mm, var -2.6mm])'
    )
  })

  test('redirects an override instance direct parameter edit to the existing call arg', () => {
    const code = `mySurfaceLine = component(start = [var -4.3mm, var -2.6mm]) {
  sketch001 = sketch(on = XY) {
    line1 = line(start = start, end = [var -4.3mm, var 0.27mm])
  }
  return sketch001
}
surfaceB = mySurfaceLine(start = [var -2mm, var -2.6mm])`
    const nextValue = '[var -1mm, var -2mm]'

    const rewritten = rewriteComponentParameterSketchSolveSource({
      ast: makeAst(code),
      code,
      editedCode: editDirectStartReference(code, nextValue),
      operations: componentInstance({
        code,
        sketchId: 8,
        isDefault: false,
        callSource: 'mySurfaceLine(start = [var -2mm, var -2.6mm])',
        argSource: '[var -2mm, var -2.6mm]',
      }),
      sketchId: 8,
    })

    expect(rewritten).toContain('component(start = [var -4.3mm, var -2.6mm])')
    expect(rewritten).toContain('line1 = line(start = start, end =')
    expect(rewritten).toContain(
      'surfaceB = mySurfaceLine(start = [var -1mm, var -2mm])'
    )
  })

  test('creates a missing override arg on the selected call', () => {
    const code = `mySurfaceLine = component(start = [var -4.3mm, var -2.6mm]) {
  sketch001 = sketch(on = XY) {
    line1 = line(start = start, end = [var -4.3mm, var 0.27mm])
  }
  return sketch001
}
surfaceB = mySurfaceLine(length = 5)`
    const nextValue = '[var -1mm, var -2mm]'

    const rewritten = rewriteComponentParameterSketchSolveSource({
      ast: makeAst(code),
      code,
      editedCode: editDirectStartReference(code, nextValue),
      operations: componentInstance({
        code,
        sketchId: 8,
        isDefault: false,
        callSource: 'mySurfaceLine(length = 5)',
        argSource: '[var -4.3mm, var -2.6mm]',
      }),
      sketchId: 8,
    })

    expect(rewritten).toContain(
      'surfaceB = mySurfaceLine(length = 5, start = [var -1mm, var -2mm])'
    )
  })

  test('keeps definition edits when the changed expression is not a direct parameter reference', () => {
    const code = `mySurfaceLine = component(start = [var -4.3mm, var -2.6mm]) {
  sketch001 = sketch(on = XY) {
    line1 = line(start + [1mm, 0], end = [var -4.3mm, var 0.27mm])
  }
  return sketch001
}
surfaceB = mySurfaceLine(start = [var -2mm, var -2.6mm])`
    const editedCode = code.replace('start + [1mm, 0]', '[var -1mm, var -2mm]')

    const rewritten = rewriteComponentParameterSketchSolveSource({
      ast: makeAst(code),
      code,
      editedCode,
      operations: componentInstance({
        code,
        sketchId: 8,
        isDefault: false,
        callSource: 'mySurfaceLine(start = [var -2mm, var -2.6mm])',
        argSource: '[var -2mm, var -2.6mm]',
      }),
      sketchId: 8,
    })

    expect(rewritten).toBeNull()
  })
})
