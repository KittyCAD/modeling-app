import { assertParse, initPromise, parse } from './wasm'
import { err } from 'lib/trap'

beforeAll(async () => {
  await initPromise
})

describe('testing AST', () => {
  test('5 + 6', () => {
    const ast = assertParse('5 +6')
    delete (ast as any).nonCodeMeta
    expect(ast.body).toEqual([
      {
        type: 'ExpressionStatement',
        start: 0,
        end: 4,

        expression: {
          type: 'BinaryExpression',
          start: 0,
          end: 4,

          left: {
            type: 'Literal',
            start: 0,
            end: 1,
            value: 5,
            raw: '5',
          },
          operator: '+',
          right: {
            type: 'Literal',
            start: 3,
            end: 4,
            value: 6,
            raw: '6',
          },
        },
      },
    ])
  })
})

describe('parsing errors', () => {
  it('should return an error when there is a unexpected closed curly brace', async () => {
    const code = `const myVar = startSketchAt([}], %)`
    const result = parse(code)
    if (err(result)) throw result
    const error = result.errors[0]
    expect(error.message).toBe('Array is missing a closing bracket(`]`)')
    expect(error.sourceRange).toEqual([28, 29, 0])
  })
})
