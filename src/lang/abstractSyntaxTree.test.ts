import {
  abstractSyntaxTree,
  findClosingBrace,
  hasPipeOperator,
  findEndOfBinaryExpression,
} from './abstractSyntaxTree'
import { lexer } from './tokeniser'

describe('findClosingBrace', () => {
  test('finds the closing brace', () => {
    const basic = '( hey )'
    expect(findClosingBrace(lexer(basic), 0)).toBe(4)

    const handlesNonZeroIndex =
      '(indexForBracketToRightOfThisIsTwo(shouldBeFour)AndNotThisSix)'
    expect(findClosingBrace(lexer(handlesNonZeroIndex), 2)).toBe(4)
    expect(findClosingBrace(lexer(handlesNonZeroIndex), 0)).toBe(6)

    const handlesNested =
      '{a{b{c(}d]}eathou athoeu tah u} thatOneToTheLeftIsLast }'
    expect(findClosingBrace(lexer(handlesNested), 0)).toBe(18)

    // throws when not started on a brace
    expect(() => findClosingBrace(lexer(handlesNested), 1)).toThrow()
  })
})

describe('testing AST', () => {
  test('test 5 + 6', () => {
    const tokens = lexer('5 +6')
    const result = abstractSyntaxTree(tokens)
    delete (result as any).nonCodeMeta
    expect(result).toEqual({
      type: 'Program',
      start: 0,
      end: 4,
      body: [
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
      ],
    })
  })
  test('test const myVar = 5', () => {
    const tokens = lexer('const myVar = 5')
    const { body } = abstractSyntaxTree(tokens)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 15,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 15,
            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              name: 'myVar',
            },
            init: {
              type: 'Literal',
              start: 14,
              end: 15,
              value: 5,
              raw: '5',
            },
          },
        ],
      },
    ])
  })
  test('test multi-line', () => {
    const code = `const myVar = 5
const newVar = myVar + 1
`
    const tokens = lexer(code)
    const { body } = abstractSyntaxTree(tokens)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 15,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 15,
            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              name: 'myVar',
            },
            init: {
              type: 'Literal',
              start: 14,
              end: 15,
              value: 5,
              raw: '5',
            },
          },
        ],
      },
      {
        type: 'VariableDeclaration',
        start: 16,
        end: 40,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 22,
            end: 40,
            id: {
              type: 'Identifier',
              start: 22,
              end: 28,
              name: 'newVar',
            },
            init: {
              type: 'BinaryExpression',
              start: 31,
              end: 40,
              left: {
                type: 'Identifier',
                start: 31,
                end: 36,
                name: 'myVar',
              },
              operator: '+',
              right: {
                type: 'Literal',
                start: 39,
                end: 40,
                value: 1,
                raw: '1',
              },
            },
          },
        ],
      },
    ])
  })
  test('test using std function "log"', () => {
    const code = `log(5, "hello", aIdentifier)`
    const tokens = lexer(code)
    const { body } = abstractSyntaxTree(tokens)
    expect(body).toEqual([
      {
        type: 'ExpressionStatement',
        start: 0,
        end: 28,
        expression: {
          type: 'CallExpression',
          start: 0,
          end: 28,
          callee: {
            type: 'Identifier',
            start: 0,
            end: 3,
            name: 'log',
          },
          arguments: [
            {
              type: 'Literal',
              start: 4,
              end: 5,
              value: 5,
              raw: '5',
            },
            {
              type: 'Literal',
              start: 7,
              end: 14,
              value: 'hello',
              raw: '"hello"',
            },
            {
              type: 'Identifier',
              start: 16,
              end: 27,
              name: 'aIdentifier',
            },
          ],
          optional: false,
        },
      },
    ])
  })
})

describe('testing function declaration', () => {
  test('fn funcN = () => {}', () => {
    const tokens = lexer('fn funcN = () => {}')
    const { body } = abstractSyntaxTree(tokens)
    delete (body[0] as any).declarations[0].init.body.nonCodeMeta
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 19,
        kind: 'fn',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 3,
            end: 19,
            id: {
              type: 'Identifier',
              start: 3,
              end: 8,
              name: 'funcN',
            },
            init: {
              type: 'FunctionExpression',
              start: 11,
              end: 19,
              id: null,
              params: [],
              body: {
                type: 'BlockStatement',
                start: 17,
                end: 19,
                body: [],
              },
            },
          },
        ],
      },
    ])
  })
  test('fn funcN = (a, b) => {return a + b}', () => {
    const tokens = lexer(
      ['fn funcN = (a, b) => {', '  return a + b', '}'].join('\n')
    )
    const { body } = abstractSyntaxTree(tokens)
    delete (body[0] as any).declarations[0].init.body.nonCodeMeta
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 39,
        kind: 'fn',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 3,
            end: 39,
            id: {
              type: 'Identifier',
              start: 3,
              end: 8,
              name: 'funcN',
            },
            init: {
              type: 'FunctionExpression',
              start: 11,
              end: 39,
              id: null,
              params: [
                {
                  type: 'Identifier',
                  start: 12,
                  end: 13,
                  name: 'a',
                },
                {
                  type: 'Identifier',
                  start: 15,
                  end: 16,
                  name: 'b',
                },
              ],
              body: {
                type: 'BlockStatement',
                start: 21,
                end: 39,
                body: [
                  {
                    type: 'ReturnStatement',
                    start: 25,
                    end: 37,
                    argument: {
                      type: 'BinaryExpression',
                      start: 32,
                      end: 37,
                      left: {
                        type: 'Identifier',
                        start: 32,
                        end: 33,
                        name: 'a',
                      },
                      operator: '+',
                      right: {
                        type: 'Identifier',
                        start: 36,
                        end: 37,
                        name: 'b',
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ])
  })
  test('call expression assignment', () => {
    const tokens = lexer(
      `fn funcN = (a, b) => { return a + b }
const myVar = funcN(1, 2)`
    )
    const { body } = abstractSyntaxTree(tokens)
    delete (body[0] as any).declarations[0].init.body.nonCodeMeta
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 37,
        kind: 'fn',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 3,
            end: 37,
            id: {
              type: 'Identifier',
              start: 3,
              end: 8,
              name: 'funcN',
            },
            init: {
              type: 'FunctionExpression',
              start: 11,
              end: 37,
              id: null,
              params: [
                {
                  type: 'Identifier',
                  start: 12,
                  end: 13,
                  name: 'a',
                },
                {
                  type: 'Identifier',
                  start: 15,
                  end: 16,
                  name: 'b',
                },
              ],
              body: {
                type: 'BlockStatement',
                start: 21,
                end: 37,
                body: [
                  {
                    type: 'ReturnStatement',
                    start: 23,
                    end: 35,
                    argument: {
                      type: 'BinaryExpression',
                      start: 30,
                      end: 35,
                      left: {
                        type: 'Identifier',
                        start: 30,
                        end: 31,
                        name: 'a',
                      },
                      operator: '+',
                      right: {
                        type: 'Identifier',
                        start: 34,
                        end: 35,
                        name: 'b',
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      {
        type: 'VariableDeclaration',
        start: 38,
        end: 63,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 44,
            end: 63,
            id: {
              type: 'Identifier',
              start: 44,
              end: 49,
              name: 'myVar',
            },
            init: {
              type: 'CallExpression',
              start: 52,
              end: 63,
              callee: {
                type: 'Identifier',
                start: 52,
                end: 57,
                name: 'funcN',
              },
              arguments: [
                {
                  type: 'Literal',
                  start: 58,
                  end: 59,
                  value: 1,
                  raw: '1',
                },
                {
                  type: 'Literal',
                  start: 61,
                  end: 62,
                  value: 2,
                  raw: '2',
                },
              ],
              optional: false,
            },
          },
        ],
      },
    ])
  })
})

describe('structures specific to this lang', () => {
  test('sketch', () => {
    let code = `sketch mySketch {
  path myPath = lineTo(0,1)
  lineTo(1,1)
  path rightPath = lineTo(1,0)
  close()
}
`
    const tokens = lexer(code)
    const { body } = abstractSyntaxTree(tokens)
    delete (body[0] as any).declarations[0].init.body.nonCodeMeta
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 102,
        kind: 'sketch',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 7,
            end: 102,
            id: {
              type: 'Identifier',
              start: 7,
              end: 15,
              name: 'mySketch',
            },
            init: {
              type: 'SketchExpression',
              start: 16,
              end: 102,
              body: {
                type: 'BlockStatement',
                start: 16,
                end: 102,
                body: [
                  {
                    type: 'VariableDeclaration',
                    start: 20,
                    end: 45,
                    kind: 'path',
                    declarations: [
                      {
                        type: 'VariableDeclarator',
                        start: 25,
                        end: 45,
                        id: {
                          type: 'Identifier',
                          start: 25,
                          end: 31,
                          name: 'myPath',
                        },
                        init: {
                          type: 'CallExpression',
                          start: 34,
                          end: 45,
                          callee: {
                            type: 'Identifier',
                            start: 34,
                            end: 40,
                            name: 'lineTo',
                          },
                          arguments: [
                            {
                              type: 'Literal',
                              start: 41,
                              end: 42,
                              value: 0,
                              raw: '0',
                            },
                            {
                              type: 'Literal',
                              start: 43,
                              end: 44,
                              value: 1,
                              raw: '1',
                            },
                          ],
                          optional: false,
                        },
                      },
                    ],
                  },
                  {
                    type: 'ExpressionStatement',
                    start: 48,
                    end: 59,
                    expression: {
                      type: 'CallExpression',
                      start: 48,
                      end: 59,
                      callee: {
                        type: 'Identifier',
                        start: 48,
                        end: 54,
                        name: 'lineTo',
                      },
                      arguments: [
                        {
                          type: 'Literal',
                          start: 55,
                          end: 56,
                          value: 1,
                          raw: '1',
                        },
                        {
                          type: 'Literal',
                          start: 57,
                          end: 58,
                          value: 1,
                          raw: '1',
                        },
                      ],
                      optional: false,
                    },
                  },
                  {
                    type: 'VariableDeclaration',
                    start: 62,
                    end: 90,
                    kind: 'path',
                    declarations: [
                      {
                        type: 'VariableDeclarator',
                        start: 67,
                        end: 90,
                        id: {
                          type: 'Identifier',
                          start: 67,
                          end: 76,
                          name: 'rightPath',
                        },
                        init: {
                          type: 'CallExpression',
                          start: 79,
                          end: 90,
                          callee: {
                            type: 'Identifier',
                            start: 79,
                            end: 85,
                            name: 'lineTo',
                          },
                          arguments: [
                            {
                              type: 'Literal',
                              start: 86,
                              end: 87,
                              value: 1,
                              raw: '1',
                            },
                            {
                              type: 'Literal',
                              start: 88,
                              end: 89,
                              value: 0,
                              raw: '0',
                            },
                          ],
                          optional: false,
                        },
                      },
                    ],
                  },
                  {
                    type: 'ExpressionStatement',
                    start: 93,
                    end: 100,
                    expression: {
                      type: 'CallExpression',
                      start: 93,
                      end: 100,
                      callee: {
                        type: 'Identifier',
                        start: 93,
                        end: 98,
                        name: 'close',
                      },
                      arguments: [],
                      optional: false,
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ])
  })
})
describe('testing hasPipeOperator', () => {
  test('hasPipeOperator is true', () => {
    let code = `sketch mySketch {
  lineTo(2, 3)
} |> rx(45, %)
`

    const tokens = lexer(code)
    const result = hasPipeOperator(tokens, 0)
    delete (result as any).bonusNonCodeNode
    expect(result).toEqual({
      index: 16,
      token: { end: 37, start: 35, type: 'operator', value: '|>' },
    })
  })
  test('matches the first pipe', () => {
    let code = `sketch mySketch {
  lineTo(2, 3)
} |> rx(45, %) |> rx(45, %)
`
    const tokens = lexer(code)
    const result = hasPipeOperator(tokens, 0)
    delete (result as any).bonusNonCodeNode
    expect(result).toEqual({
      index: 16,
      token: { end: 37, start: 35, type: 'operator', value: '|>' },
    })
    if (!result) throw new Error('should not happen')
    expect(code.slice(result.token.start, result.token.end)).toEqual('|>')
  })
  test('hasPipeOperator is false when the pipe operator is after a new variable declaration', () => {
    let code = `sketch mySketch {
  lineTo(2, 3)
}
const yo = myFunc(9()
  |> rx(45, %)
`
    const tokens = lexer(code)
    expect(hasPipeOperator(tokens, 0)).toEqual(false)
  })
  test('hasPipeOperator with binary expression', () => {
    let code = `const myVar2 = 5 + 1 |> myFn(%)`
    const tokens = lexer(code)
    const result = hasPipeOperator(tokens, 1)
    delete (result as any).bonusNonCodeNode
    expect(result).toEqual({
      index: 12,
      token: { end: 23, start: 21, type: 'operator', value: '|>' },
    })
    if (!result) throw new Error('should not happen')
    expect(code.slice(result.token.start, result.token.end)).toEqual('|>')
  })
  test('hasPipeOperator of called mid sketchExpression on a callExpression, and called at the start of the sketchExpression at "{"', () => {
    const code = [
      'sketch mySk1 {',
      '  lineTo(1,1)',
      '  path myPath = lineTo(0, 1)',
      '  lineTo(1,1)',
      '} |> rx(90, %)',
      'show(mySk1)',
    ].join('\n')
    const tokens = lexer(code)
    const tokenWithMyPathIndex = tokens.findIndex(
      ({ value }) => value === 'myPath'
    )
    const tokenWithLineToIndexForVarDecIndex = tokens.findIndex(
      ({ value }, index) => value === 'lineTo' && index > tokenWithMyPathIndex
    )
    const result = hasPipeOperator(tokens, tokenWithLineToIndexForVarDecIndex)
    expect(result).toBe(false)

    const braceTokenIndex = tokens.findIndex(({ value }) => value === '{')
    const result2 = hasPipeOperator(tokens, braceTokenIndex)
    delete (result2 as any).bonusNonCodeNode
    expect(result2).toEqual({
      index: 36,
      token: { end: 76, start: 74, type: 'operator', value: '|>' },
    })
    if (!result2) throw new Error('should not happen')
    expect(code.slice(result2?.token?.start, result2?.token?.end)).toEqual('|>')
  })
})

describe('testing pipe operator special', () => {
  test('pipe operator with sketch', () => {
    let code = `sketch mySketch {
  lineTo(2, 3)
  path myPath = lineTo(0, 1)
  lineTo(1,1)
} |> rx(45, %)
`
    const tokens = lexer(code)
    const { body } = abstractSyntaxTree(tokens)
    delete (body[0] as any).declarations[0].init.nonCodeMeta
    delete (body[0] as any).declarations[0].init.body[0].body.nonCodeMeta
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 90,
        kind: 'sketch',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 7,
            end: 90,
            id: {
              type: 'Identifier',
              start: 7,
              end: 15,
              name: 'mySketch',
            },
            init: {
              type: 'PipeExpression',
              start: 16,
              end: 90,
              body: [
                {
                  type: 'SketchExpression',
                  start: 16,
                  end: 77,
                  body: {
                    type: 'BlockStatement',
                    start: 16,
                    end: 77,
                    body: [
                      {
                        type: 'ExpressionStatement',
                        start: 20,
                        end: 32,
                        expression: {
                          type: 'CallExpression',
                          start: 20,
                          end: 32,
                          callee: {
                            type: 'Identifier',
                            start: 20,
                            end: 26,
                            name: 'lineTo',
                          },
                          arguments: [
                            {
                              type: 'Literal',
                              start: 27,
                              end: 28,
                              value: 2,
                              raw: '2',
                            },
                            {
                              type: 'Literal',
                              start: 30,
                              end: 31,
                              value: 3,
                              raw: '3',
                            },
                          ],
                          optional: false,
                        },
                      },
                      {
                        type: 'VariableDeclaration',
                        start: 35,
                        end: 61,
                        kind: 'path',
                        declarations: [
                          {
                            type: 'VariableDeclarator',
                            start: 40,
                            end: 61,
                            id: {
                              type: 'Identifier',
                              start: 40,
                              end: 46,
                              name: 'myPath',
                            },
                            init: {
                              type: 'CallExpression',
                              start: 49,
                              end: 61,
                              callee: {
                                type: 'Identifier',
                                start: 49,
                                end: 55,
                                name: 'lineTo',
                              },
                              arguments: [
                                {
                                  type: 'Literal',
                                  start: 56,
                                  end: 57,
                                  value: 0,
                                  raw: '0',
                                },
                                {
                                  type: 'Literal',
                                  start: 59,
                                  end: 60,
                                  value: 1,
                                  raw: '1',
                                },
                              ],
                              optional: false,
                            },
                          },
                        ],
                      },
                      {
                        type: 'ExpressionStatement',
                        start: 64,
                        end: 75,
                        expression: {
                          type: 'CallExpression',
                          start: 64,
                          end: 75,
                          callee: {
                            type: 'Identifier',
                            start: 64,
                            end: 70,
                            name: 'lineTo',
                          },
                          arguments: [
                            {
                              type: 'Literal',
                              start: 71,
                              end: 72,
                              value: 1,
                              raw: '1',
                            },
                            {
                              type: 'Literal',
                              start: 73,
                              end: 74,
                              value: 1,
                              raw: '1',
                            },
                          ],
                          optional: false,
                        },
                      },
                    ],
                  },
                },
                {
                  type: 'CallExpression',
                  start: 81,
                  end: 90,
                  callee: {
                    type: 'Identifier',
                    start: 81,
                    end: 83,
                    name: 'rx',
                  },
                  arguments: [
                    {
                      type: 'Literal',
                      start: 84,
                      end: 86,
                      value: 45,
                      raw: '45',
                    },
                    {
                      type: 'PipeSubstitution',
                      start: 88,
                      end: 89,
                    },
                  ],
                  optional: false,
                },
              ],
            },
          },
        ],
      },
    ])
  })
  test('pipe operator with binary expression', () => {
    let code = `const myVar = 5 + 6 |> myFunc(45, %)`
    const tokens = lexer(code)
    const { body } = abstractSyntaxTree(tokens)
    delete (body as any)[0].declarations[0].init.nonCodeMeta
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 36,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 36,
            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              name: 'myVar',
            },
            init: {
              type: 'PipeExpression',
              start: 12,
              end: 36,
              body: [
                {
                  type: 'BinaryExpression',
                  start: 14,
                  end: 19,
                  left: {
                    type: 'Literal',
                    start: 14,
                    end: 15,
                    value: 5,
                    raw: '5',
                  },
                  operator: '+',
                  right: {
                    type: 'Literal',
                    start: 18,
                    end: 19,
                    value: 6,
                    raw: '6',
                  },
                },
                {
                  type: 'CallExpression',
                  start: 23,
                  end: 36,
                  callee: {
                    type: 'Identifier',
                    start: 23,
                    end: 29,
                    name: 'myFunc',
                  },
                  arguments: [
                    {
                      type: 'Literal',
                      start: 30,
                      end: 32,
                      value: 45,
                      raw: '45',
                    },
                    {
                      type: 'PipeSubstitution',
                      start: 34,
                      end: 35,
                    },
                  ],
                  optional: false,
                },
              ],
            },
          },
        ],
      },
    ])
  })
  test('array expression', () => {
    let code = `const yo = [1, '2', three, 4 + 5]`
    const tokens = lexer(code)
    const { body } = abstractSyntaxTree(tokens)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 33,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 33,
            id: {
              type: 'Identifier',
              start: 6,
              end: 8,
              name: 'yo',
            },
            init: {
              type: 'ArrayExpression',
              start: 11,
              end: 33,
              elements: [
                {
                  type: 'Literal',
                  start: 12,
                  end: 13,
                  value: 1,
                  raw: '1',
                },
                {
                  type: 'Literal',
                  start: 15,
                  end: 18,
                  value: '2',
                  raw: "'2'",
                },
                {
                  type: 'Identifier',
                  start: 20,
                  end: 25,
                  name: 'three',
                },
                {
                  type: 'BinaryExpression',
                  start: 27,
                  end: 32,
                  left: {
                    type: 'Literal',
                    start: 27,
                    end: 28,
                    value: 4,
                    raw: '4',
                  },
                  operator: '+',
                  right: {
                    type: 'Literal',
                    start: 31,
                    end: 32,
                    value: 5,
                    raw: '5',
                  },
                },
              ],
            },
          },
        ],
      },
    ])
  })
  test('object expression ast', () => {
    const code = [
      'const three = 3',
      "const yo = {aStr: 'str', anum: 2, identifier: three, binExp: 4 + 5}",
    ].join('\n')
    const tokens = lexer(code)
    const { body } = abstractSyntaxTree(tokens)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 15,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 15,
            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              name: 'three',
            },
            init: {
              type: 'Literal',
              start: 14,
              end: 15,
              value: 3,
              raw: '3',
            },
          },
        ],
      },
      {
        type: 'VariableDeclaration',
        start: 16,
        end: 83,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 22,
            end: 83,
            id: {
              type: 'Identifier',
              start: 22,
              end: 24,
              name: 'yo',
            },
            init: {
              type: 'ObjectExpression',
              start: 27,
              end: 83,
              properties: [
                {
                  type: 'ObjectProperty',
                  start: 28,
                  end: 39,
                  key: {
                    type: 'Identifier',
                    start: 28,
                    end: 32,
                    name: 'aStr',
                  },
                  value: {
                    type: 'Literal',
                    start: 34,
                    end: 39,
                    value: 'str',
                    raw: "'str'",
                  },
                },
                {
                  type: 'ObjectProperty',
                  start: 41,
                  end: 48,
                  key: {
                    type: 'Identifier',
                    start: 41,
                    end: 45,
                    name: 'anum',
                  },
                  value: {
                    type: 'Literal',
                    start: 47,
                    end: 48,
                    value: 2,
                    raw: '2',
                  },
                },
                {
                  type: 'ObjectProperty',
                  start: 50,
                  end: 67,
                  key: {
                    type: 'Identifier',
                    start: 50,
                    end: 60,
                    name: 'identifier',
                  },
                  value: {
                    type: 'Identifier',
                    start: 62,
                    end: 67,
                    name: 'three',
                  },
                },
                {
                  type: 'ObjectProperty',
                  start: 69,
                  end: 82,
                  key: {
                    type: 'Identifier',
                    start: 69,
                    end: 75,
                    name: 'binExp',
                  },
                  value: {
                    type: 'BinaryExpression',
                    start: 77,
                    end: 82,
                    left: {
                      type: 'Literal',
                      start: 77,
                      end: 78,
                      value: 4,
                      raw: '4',
                    },
                    operator: '+',
                    right: {
                      type: 'Literal',
                      start: 81,
                      end: 82,
                      value: 5,
                      raw: '5',
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    ])
  })
  test('nested object expression ast', () => {
    const code = `const yo = {key: {
  key2: 'value'
}}`
    const tokens = lexer(code)
    const { body } = abstractSyntaxTree(tokens)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 37,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 37,
            id: {
              type: 'Identifier',
              start: 6,
              end: 8,
              name: 'yo',
            },
            init: {
              type: 'ObjectExpression',
              start: 11,
              end: 37,
              properties: [
                {
                  type: 'ObjectProperty',
                  start: 12,
                  end: 36,
                  key: {
                    type: 'Identifier',
                    start: 12,
                    end: 15,
                    name: 'key',
                  },
                  value: {
                    type: 'ObjectExpression',
                    start: 17,
                    end: 36,
                    properties: [
                      {
                        type: 'ObjectProperty',
                        start: 21,
                        end: 34,
                        key: {
                          type: 'Identifier',
                          start: 21,
                          end: 25,
                          name: 'key2',
                        },
                        value: {
                          type: 'Literal',
                          start: 27,
                          end: 34,
                          value: 'value',
                          raw: "'value'",
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    ])
  })
  test('object expression with array ast', () => {
    const code = `const yo = {key: [1, '2']}`
    const tokens = lexer(code)
    const { body } = abstractSyntaxTree(tokens)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 26,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 26,
            id: {
              type: 'Identifier',
              start: 6,
              end: 8,
              name: 'yo',
            },
            init: {
              type: 'ObjectExpression',
              start: 11,
              end: 26,
              properties: [
                {
                  type: 'ObjectProperty',
                  start: 12,
                  end: 25,
                  key: {
                    type: 'Identifier',
                    start: 12,
                    end: 15,
                    name: 'key',
                  },
                  value: {
                    type: 'ArrayExpression',
                    start: 17,
                    end: 25,
                    elements: [
                      {
                        type: 'Literal',
                        start: 18,
                        end: 19,
                        value: 1,
                        raw: '1',
                      },
                      {
                        type: 'Literal',
                        start: 21,
                        end: 24,
                        value: '2',
                        raw: "'2'",
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    ])
  })
  test('object memberExpression simple', () => {
    const code = `const prop = yo.one.two`
    const tokens = lexer(code)
    const { body } = abstractSyntaxTree(tokens)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 23,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 23,
            id: {
              type: 'Identifier',
              start: 6,
              end: 10,
              name: 'prop',
            },
            init: {
              type: 'MemberExpression',
              start: 13,
              end: 23,
              computed: false,
              object: {
                type: 'MemberExpression',
                start: 13,
                end: 19,
                computed: false,
                object: {
                  type: 'Identifier',
                  start: 13,
                  end: 15,
                  name: 'yo',
                },
                property: {
                  type: 'Identifier',
                  start: 16,
                  end: 19,
                  name: 'one',
                },
              },
              property: {
                type: 'Identifier',
                start: 20,
                end: 23,
                name: 'two',
              },
            },
          },
        ],
      },
    ])
  })
  test('object memberExpression with square braces', () => {
    const code = `const prop = yo.one["two"]`
    const tokens = lexer(code)
    const { body } = abstractSyntaxTree(tokens)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 26,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 26,
            id: {
              type: 'Identifier',
              start: 6,
              end: 10,
              name: 'prop',
            },
            init: {
              type: 'MemberExpression',
              start: 13,
              end: 26,
              computed: false,
              object: {
                type: 'MemberExpression',
                start: 13,
                end: 19,
                computed: false,
                object: {
                  type: 'Identifier',
                  start: 13,
                  end: 15,
                  name: 'yo',
                },
                property: {
                  type: 'Identifier',
                  start: 16,
                  end: 19,
                  name: 'one',
                },
              },
              property: {
                type: 'Literal',
                start: 20,
                end: 25,
                value: 'two',
                raw: '"two"',
              },
            },
          },
        ],
      },
    ])
  })
  test('object memberExpression with two square braces literal and identifier', () => {
    const code = `const prop = yo["one"][two]`
    const tokens = lexer(code)
    const { body } = abstractSyntaxTree(tokens)
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 27,
        kind: 'const',
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 27,
            id: {
              type: 'Identifier',
              start: 6,
              end: 10,
              name: 'prop',
            },
            init: {
              type: 'MemberExpression',
              start: 13,
              end: 27,
              computed: true,
              object: {
                type: 'MemberExpression',
                start: 13,
                end: 22,
                computed: false,
                object: {
                  type: 'Identifier',
                  start: 13,
                  end: 15,
                  name: 'yo',
                },
                property: {
                  type: 'Literal',
                  start: 16,
                  end: 21,
                  value: 'one',
                  raw: '"one"',
                },
              },
              property: {
                type: 'Identifier',
                start: 23,
                end: 26,
                name: 'two',
              },
            },
          },
        ],
      },
    ])
  })
})

describe('nests binary expressions correctly', () => {
  it('it works with the simple case', () => {
    const code = `const yo = 1 + 2`
    const { body } = abstractSyntaxTree(lexer(code))
    expect(body[0]).toEqual({
      type: 'VariableDeclaration',
      start: 0,
      end: 16,
      kind: 'const',
      declarations: [
        {
          type: 'VariableDeclarator',
          start: 6,
          end: 16,
          id: {
            type: 'Identifier',
            start: 6,
            end: 8,
            name: 'yo',
          },
          init: {
            type: 'BinaryExpression',
            start: 11,
            end: 16,
            left: {
              type: 'Literal',
              start: 11,
              end: 12,
              value: 1,
              raw: '1',
            },
            operator: '+',
            right: {
              type: 'Literal',
              start: 15,
              end: 16,
              value: 2,
              raw: '2',
            },
          },
        },
      ],
    })
  })
  it('it should nest according to precedence with multiply first', () => {
    // should be binExp { binExp { lit-1 * lit-2 } + lit}
    const code = `const yo = 1 * 2 + 3`
    const { body } = abstractSyntaxTree(lexer(code))
    expect(body[0]).toEqual({
      type: 'VariableDeclaration',
      start: 0,
      end: 20,
      kind: 'const',
      declarations: [
        {
          type: 'VariableDeclarator',
          start: 6,
          end: 20,
          id: {
            type: 'Identifier',
            start: 6,
            end: 8,
            name: 'yo',
          },
          init: {
            type: 'BinaryExpression',
            start: 11,
            end: 20,
            left: {
              type: 'BinaryExpression',
              start: 11,
              end: 16,
              left: {
                type: 'Literal',
                start: 11,
                end: 12,
                value: 1,
                raw: '1',
              },
              operator: '*',
              right: {
                type: 'Literal',
                start: 15,
                end: 16,
                value: 2,
                raw: '2',
              },
            },
            operator: '+',
            right: {
              type: 'Literal',
              start: 19,
              end: 20,
              value: 3,
              raw: '3',
            },
          },
        },
      ],
    })
  })
  it('it should nest according to precedence with sum first', () => {
    // should be binExp { lit-1 + binExp { lit-2 * lit-3 } }
    const code = `const yo = 1 + 2 * 3`
    const { body } = abstractSyntaxTree(lexer(code))
    expect(body[0]).toEqual({
      type: 'VariableDeclaration',
      start: 0,
      end: 20,
      kind: 'const',
      declarations: [
        {
          type: 'VariableDeclarator',
          start: 6,
          end: 20,
          id: {
            type: 'Identifier',
            start: 6,
            end: 8,
            name: 'yo',
          },
          init: {
            type: 'BinaryExpression',
            start: 11,
            end: 20,
            left: {
              type: 'Literal',
              start: 11,
              end: 12,
              value: 1,
              raw: '1',
            },
            operator: '+',
            right: {
              type: 'BinaryExpression',
              start: 15,
              end: 20,
              left: {
                type: 'Literal',
                start: 15,
                end: 16,
                value: 2,
                raw: '2',
              },
              operator: '*',
              right: {
                type: 'Literal',
                start: 19,
                end: 20,
                value: 3,
                raw: '3',
              },
            },
          },
        },
      ],
    })
  })
  it('it should nest properly with two opperators of equal precedence', () => {
    const code = `const yo = 1 + 2 - 3`
    const { body } = abstractSyntaxTree(lexer(code))
    expect((body[0] as any).declarations[0].init).toEqual({
      type: 'BinaryExpression',
      start: 11,
      end: 20,
      left: {
        type: 'BinaryExpression',
        start: 11,
        end: 16,
        left: {
          type: 'Literal',
          start: 11,
          end: 12,
          value: 1,
          raw: '1',
        },
        operator: '+',
        right: {
          type: 'Literal',
          start: 15,
          end: 16,
          value: 2,
          raw: '2',
        },
      },
      operator: '-',
      right: {
        type: 'Literal',
        start: 19,
        end: 20,
        value: 3,
        raw: '3',
      },
    })
  })
  it('it should nest properly with two opperators of equal (but higher) precedence', () => {
    const code = `const yo = 1 * 2 / 3`
    const { body } = abstractSyntaxTree(lexer(code))
    expect((body[0] as any).declarations[0].init).toEqual({
      type: 'BinaryExpression',
      start: 11,
      end: 20,
      left: {
        type: 'BinaryExpression',
        start: 11,
        end: 16,
        left: {
          type: 'Literal',
          start: 11,
          end: 12,
          value: 1,
          raw: '1',
        },
        operator: '*',
        right: {
          type: 'Literal',
          start: 15,
          end: 16,
          value: 2,
          raw: '2',
        },
      },
      operator: '/',
      right: {
        type: 'Literal',
        start: 19,
        end: 20,
        value: 3,
        raw: '3',
      },
    })
  })
  it('it should nest properly with longer example', () => {
    const code = `const yo = 1 + 2 * (3 - 4) / 5 + 6`
    const { body } = abstractSyntaxTree(lexer(code))
    const init = (body[0] as any).declarations[0].init
    expect(init).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      start: 11,
      end: 34,
      left: {
        type: 'BinaryExpression',
        operator: '+',
        start: 11,
        end: 30,
        left: { type: 'Literal', value: 1, raw: '1', start: 11, end: 12 },
        right: {
          type: 'BinaryExpression',
          operator: '/',
          start: 15,
          end: 30,
          left: {
            type: 'BinaryExpression',
            operator: '*',
            start: 15,
            end: 26,
            left: { type: 'Literal', value: 2, raw: '2', start: 15, end: 16 },
            right: {
              type: 'BinaryExpression',
              operator: '-',
              start: 20,
              end: 25,
              left: { type: 'Literal', value: 3, raw: '3', start: 20, end: 21 },
              right: {
                type: 'Literal',
                value: 4,
                raw: '4',
                start: 24,
                end: 25,
              },
            },
          },
          right: { type: 'Literal', value: 5, raw: '5', start: 29, end: 30 },
        },
      },
      right: { type: 'Literal', value: 6, raw: '6', start: 33, end: 34 },
    })
  })
})

describe('check nonCodeMeta data is attached to the AST correctly', () => {
  it('comments between expressions', () => {
    const code = `
const yo = { a: { b: { c: '123' } } }
// this is a comment
const key = 'c'`
    const nonCodeMetaInstance = {
      type: 'NoneCodeNode',
      start: code.indexOf('\n// this is a comment'),
      end: code.indexOf('const key'),
      value: '\n// this is a comment\n',
    }
    const { nonCodeMeta } = abstractSyntaxTree(lexer(code))
    expect(nonCodeMeta[0]).toEqual(nonCodeMetaInstance)

    // extra whitespace won't change it's position (0) or value (NB the start end would have changed though)
    const codeWithExtraStartWhitespace = '\n\n\n' + code
    const { nonCodeMeta: nonCodeMeta2 } = abstractSyntaxTree(
      lexer(codeWithExtraStartWhitespace)
    )
    expect(nonCodeMeta2[0].value).toBe(nonCodeMetaInstance.value)
    expect(nonCodeMeta2[0].start).not.toBe(nonCodeMetaInstance.start)
  })
  it('comments nested within a block statement', () => {
    const code = `sketch mySketch {
      path myPath = lineTo(0,1)
      lineTo(1,1) /* this is 
      a comment 
      spanning a few lines */
      path rightPath = lineTo(1,0)
      close()
    }
    `

    const { body } = abstractSyntaxTree(lexer(code))
    const indexOfSecondLineToExpression = 1 // 0 index so `path myPath = lineTo(0,1)` is 0
    const sketchNonCodeMeta = (body as any)[0].declarations[0].init.body
      .nonCodeMeta
    expect(sketchNonCodeMeta[indexOfSecondLineToExpression]).toEqual({
      type: 'NoneCodeNode',
      start: 67,
      end: 133,
      value:
        ' /* this is \n      a comment \n      spanning a few lines */\n      ',
    })
  })
  it('comments in a pipe expression', () => {
    const code = [
      'sketch mySk1 {',
      '  lineTo(1, 1)',
      '  path myPath = lineTo(0, 1)',
      '  lineTo(1, 1)',
      '}',
      '// a comment',
      '  |> rx(90, %)',
    ].join('\n')

    const { body } = abstractSyntaxTree(lexer(code))
    const bing = abstractSyntaxTree(lexer(code))
    const sketchNonCodeMeta = (body[0] as any).declarations[0].init.nonCodeMeta
    expect(1).toBe(1)
    expect(sketchNonCodeMeta[0]).toEqual({
      type: 'NoneCodeNode',
      start: 75,
      end: 91,
      value: '\n// a comment\n  ',
    })
  })
})

describe('testing findEndofBinaryExpression', () => {
  it('1 + 2 * 3', () => {
    const code = `1 + 2 * 3\nconst yo = 5`
    const tokens = lexer(code)
    const end = findEndOfBinaryExpression(tokens, 0)
    expect(end).toBe(8)
  })
  it('(1 + 2) / 5 - 3', () => {
    const code = `(1 + 25) / 5 - 3\nconst yo = 5`
    const tokens = lexer(code)
    const end = findEndOfBinaryExpression(tokens, 0)
    expect(end).toBe(14)

    // expect to have the same end if started later in the string at a legitimate place
    const indexOf5 = code.indexOf('5')
    const endStartingAtThe5 = findEndOfBinaryExpression(tokens, indexOf5)
    expect(endStartingAtThe5).toBe(end)
  })
  it('whole thing wraped: ((1 + 2) / 5 - 3)', () => {
    const code = '((1 + 2) / 5 - 3)\nconst yo = 5'
    const tokens = lexer(code)
    const end = findEndOfBinaryExpression(tokens, 0)
    expect(end).toBe(code.indexOf('3)') + 1)
  })
  it('whole thing wraped but given index after the first brace: ((1 + 2) / 5 - 3)', () => {
    const code = '((1 + 2) / 5 - 3)\nconst yo = 5'
    const tokens = lexer(code)
    const end = findEndOfBinaryExpression(tokens, 1)
    expect(end).toBe(code.indexOf('3'))
  })
  it('given the index of a small wrapped section i.e. `1 + 2` in ((1 + 2) / 5 - 3)', () => {
    const code = '((1 + 2) / 5 - 3)\nconst yo = 5'
    const tokens = lexer(code)
    const end = findEndOfBinaryExpression(tokens, 2)
    expect(end).toBe(code.indexOf('2'))
  })
  it('lots of silly nesting: (1 + 2) / (5 - (3))', () => {
    const code = '(1 + 2) / (5 - (3))\nconst yo = 5'
    const tokens = lexer(code)
    const end = findEndOfBinaryExpression(tokens, 0)
    expect(end).toBe(code.indexOf('))') + 1)
  })
  it('with pipe operator at the end', () => {
    const code = '(1 + 2) / (5 - (3))\n  |> fn(%)'
    const tokens = lexer(code)
    const end = findEndOfBinaryExpression(tokens, 0)
    expect(end).toBe(code.indexOf('))') + 1)
  })
})
