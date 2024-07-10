import { KCLError } from './errors'
import { initPromise, parse } from './wasm'
import { err } from 'lib/trap'

beforeAll(async () => {
  await initPromise
})

describe('testing AST', () => {
  test('5 + 6', () => {
    const result = parse('5 +6')
    if (err(result)) throw result
    delete (result as any).nonCodeMeta
    expect(result.body).toEqual([
      {
        type: 'ExpressionStatement',
        start: 0,
        end: 4,
        digest: null,
        expression: {
          type: 'BinaryExpression',
          start: 0,
          end: 4,
          digest: null,
          left: {
            type: 'Literal',
            start: 0,
            end: 1,
            value: 5,
            raw: '5',
            digest: null,
          },
          operator: '+',
          right: {
            type: 'Literal',
            start: 3,
            end: 4,
            value: 6,
            raw: '6',
            digest: null,
          },
        },
      },
    ])
  })
  test('const myVar = 5', () => {
    const ast = parse('const myVar = 5')
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 15,
        kind: 'const',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 15,
            digest: null,
            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              name: 'myVar',
              digest: null,
            },
            init: {
              type: 'Literal',
              start: 14,
              end: 15,
              value: 5,
              raw: '5',
              digest: null,
            },
          },
        ],
      },
    ])
  })
  test('multi-line', () => {
    const code = `const myVar = 5
const newVar = myVar + 1
`
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 15,
        kind: 'const',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 15,
            digest: null,
            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              name: 'myVar',
              digest: null,
            },
            init: {
              type: 'Literal',
              start: 14,
              end: 15,
              value: 5,
              raw: '5',
              digest: null,
            },
          },
        ],
      },
      {
        type: 'VariableDeclaration',
        start: 16,
        end: 40,
        kind: 'const',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 22,
            end: 40,
            digest: null,
            id: {
              type: 'Identifier',
              start: 22,
              end: 28,
              name: 'newVar',
              digest: null,
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
                digest: null,
              },
              operator: '+',
              right: {
                type: 'Literal',
                start: 39,
                end: 40,
                value: 1,
                raw: '1',
                digest: null,
              },
              digest: null,
            },
          },
        ],
      },
    ])
  })
})

describe('testing function declaration', () => {
  test('fn funcN = (a, b) => {return a + b}', () => {
    const ast = parse(
      ['fn funcN = (a, b) => {', '  return a + b', '}'].join('\n')
    )
    if (err(ast)) throw ast
    const { body } = ast
    delete (body[0] as any).declarations[0].init.body.nonCodeMeta
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 39,
        kind: 'fn',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 3,
            end: 39,
            digest: null,
            id: {
              type: 'Identifier',
              start: 3,
              end: 8,
              name: 'funcN',
              digest: null,
            },
            init: {
              type: 'FunctionExpression',
              start: 11,
              end: 39,
              digest: null,
              params: [
                {
                  type: 'Parameter',
                  identifier: {
                    type: 'Identifier',
                    start: 12,
                    end: 13,
                    name: 'a',
                    digest: null,
                  },
                  optional: false,
                  digest: null,
                },
                {
                  type: 'Parameter',
                  identifier: {
                    type: 'Identifier',
                    start: 15,
                    end: 16,
                    name: 'b',
                    digest: null,
                  },
                  optional: false,
                  digest: null,
                },
              ],
              body: {
                start: 21,
                end: 39,
                digest: null,
                body: [
                  {
                    type: 'ReturnStatement',
                    start: 25,
                    end: 37,
                    digest: null,
                    argument: {
                      type: 'BinaryExpression',
                      start: 32,
                      end: 37,
                      digest: null,
                      left: {
                        type: 'Identifier',
                        start: 32,
                        end: 33,
                        name: 'a',
                        digest: null,
                      },
                      operator: '+',
                      right: {
                        type: 'Identifier',
                        start: 36,
                        end: 37,
                        name: 'b',
                        digest: null,
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
    const code = `fn funcN = (a, b) => { return a + b }
const myVar = funcN(1, 2)`
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    delete (body[0] as any).declarations[0].init.body.nonCodeMeta
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 37,
        kind: 'fn',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 3,
            end: 37,
            digest: null,
            id: {
              type: 'Identifier',
              start: 3,
              end: 8,
              name: 'funcN',
              digest: null,
            },
            init: {
              type: 'FunctionExpression',
              start: 11,
              end: 37,
              digest: null,
              params: [
                {
                  type: 'Parameter',
                  identifier: {
                    type: 'Identifier',
                    start: 12,
                    end: 13,
                    name: 'a',
                    digest: null,
                  },
                  optional: false,
                  digest: null,
                },
                {
                  type: 'Parameter',
                  identifier: {
                    type: 'Identifier',
                    start: 15,
                    end: 16,
                    name: 'b',
                    digest: null,
                  },
                  optional: false,
                  digest: null,
                },
              ],
              body: {
                start: 21,
                end: 37,
                digest: null,
                body: [
                  {
                    type: 'ReturnStatement',
                    start: 23,
                    end: 35,
                    digest: null,
                    argument: {
                      type: 'BinaryExpression',
                      start: 30,
                      end: 35,
                      digest: null,
                      left: {
                        type: 'Identifier',
                        start: 30,
                        end: 31,
                        digest: null,
                        name: 'a',
                      },
                      operator: '+',
                      right: {
                        type: 'Identifier',
                        start: 34,
                        end: 35,
                        digest: null,
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
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 44,
            end: 63,
            digest: null,
            id: {
              type: 'Identifier',
              start: 44,
              end: 49,
              name: 'myVar',
              digest: null,
            },
            init: {
              type: 'CallExpression',
              start: 52,
              end: 63,
              digest: null,
              callee: {
                type: 'Identifier',
                start: 52,
                end: 57,
                name: 'funcN',
                digest: null,
              },
              arguments: [
                {
                  type: 'Literal',
                  start: 58,
                  end: 59,
                  value: 1,
                  raw: '1',
                  digest: null,
                },
                {
                  type: 'Literal',
                  start: 61,
                  end: 62,
                  value: 2,
                  raw: '2',
                  digest: null,
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

describe('testing pipe operator special', () => {
  test('pipe operator with sketch', () => {
    let code = `const mySketch = startSketchAt([0, 0])
  |> lineTo([2, 3], %)
  |> lineTo([0, 1], %, "myPath")
  |> lineTo([1, 1], %)
  |> rx(45, %)
`
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    delete (body[0] as any).declarations[0].init.nonCodeMeta
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 132,
        kind: 'const',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 132,
            id: {
              type: 'Identifier',
              start: 6,
              end: 14,
              name: 'mySketch',
              digest: null,
            },
            digest: null,
            init: {
              type: 'PipeExpression',
              start: 17,
              end: 132,
              digest: null,
              body: [
                {
                  type: 'CallExpression',
                  start: 17,
                  end: 38,
                  digest: null,
                  callee: {
                    type: 'Identifier',
                    start: 17,
                    end: 30,
                    name: 'startSketchAt',
                    digest: null,
                  },
                  arguments: [
                    {
                      type: 'ArrayExpression',
                      start: 31,
                      end: 37,
                      digest: null,
                      elements: [
                        {
                          type: 'Literal',
                          start: 32,
                          end: 33,
                          value: 0,
                          raw: '0',
                          digest: null,
                        },
                        {
                          type: 'Literal',
                          start: 35,
                          end: 36,
                          value: 0,
                          raw: '0',
                          digest: null,
                        },
                      ],
                    },
                  ],
                  optional: false,
                },
                {
                  type: 'CallExpression',
                  start: 44,
                  end: 61,
                  digest: null,
                  callee: {
                    type: 'Identifier',
                    start: 44,
                    end: 50,
                    digest: null,
                    name: 'lineTo',
                  },
                  arguments: [
                    {
                      type: 'ArrayExpression',
                      start: 51,
                      end: 57,
                      digest: null,
                      elements: [
                        {
                          type: 'Literal',
                          start: 52,
                          end: 53,
                          value: 2,
                          raw: '2',
                          digest: null,
                        },
                        {
                          type: 'Literal',
                          start: 55,
                          end: 56,
                          value: 3,
                          raw: '3',
                          digest: null,
                        },
                      ],
                    },
                    {
                      type: 'PipeSubstitution',
                      start: 59,
                      end: 60,
                      digest: null,
                    },
                  ],
                  optional: false,
                },
                {
                  type: 'CallExpression',
                  start: 67,
                  end: 94,
                  digest: null,
                  callee: {
                    type: 'Identifier',
                    start: 67,
                    end: 73,
                    name: 'lineTo',
                    digest: null,
                  },
                  arguments: [
                    {
                      type: 'ArrayExpression',
                      start: 74,
                      end: 80,
                      digest: null,
                      elements: [
                        {
                          type: 'Literal',
                          start: 75,
                          end: 76,
                          value: 0,
                          raw: '0',
                          digest: null,
                        },
                        {
                          type: 'Literal',
                          start: 78,
                          end: 79,
                          value: 1,
                          raw: '1',
                          digest: null,
                        },
                      ],
                    },
                    {
                      type: 'PipeSubstitution',
                      start: 82,
                      end: 83,
                      digest: null,
                    },
                    {
                      type: 'TagDeclarator',
                      start: 85,
                      end: 93,
                      value: 'myPath',
                      digest: null,
                    },
                  ],
                  optional: false,
                },
                {
                  type: 'CallExpression',
                  start: 100,
                  end: 117,
                  digest: null,
                  callee: {
                    type: 'Identifier',
                    start: 100,
                    end: 106,
                    name: 'lineTo',
                    digest: null,
                  },
                  arguments: [
                    {
                      type: 'ArrayExpression',
                      start: 107,
                      end: 113,
                      digest: null,
                      elements: [
                        {
                          type: 'Literal',
                          start: 108,
                          end: 109,
                          value: 1,
                          raw: '1',
                          digest: null,
                        },
                        {
                          type: 'Literal',
                          start: 111,
                          end: 112,
                          value: 1,
                          raw: '1',
                          digest: null,
                        },
                      ],
                    },
                    {
                      type: 'PipeSubstitution',
                      start: 115,
                      end: 116,
                      digest: null,
                    },
                  ],
                  optional: false,
                },
                {
                  type: 'CallExpression',
                  start: 123,
                  end: 132,
                  digest: null,
                  callee: {
                    type: 'Identifier',
                    start: 123,
                    end: 125,
                    name: 'rx',
                    digest: null,
                  },
                  arguments: [
                    {
                      type: 'Literal',
                      start: 126,
                      end: 128,
                      value: 45,
                      raw: '45',
                      digest: null,
                    },
                    {
                      type: 'PipeSubstitution',
                      start: 130,
                      end: 131,
                      digest: null,
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
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    delete (body as any)[0].declarations[0].init.nonCodeMeta
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 36,
        kind: 'const',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 36,
            digest: null,
            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              name: 'myVar',
              digest: null,
            },
            init: {
              type: 'PipeExpression',
              start: 14,
              end: 36,
              digest: null,
              body: [
                {
                  type: 'BinaryExpression',
                  start: 14,
                  end: 19,
                  digest: null,
                  left: {
                    type: 'Literal',
                    start: 14,
                    end: 15,
                    value: 5,
                    raw: '5',
                    digest: null,
                  },
                  operator: '+',
                  right: {
                    type: 'Literal',
                    start: 18,
                    end: 19,
                    value: 6,
                    raw: '6',
                    digest: null,
                  },
                },
                {
                  type: 'CallExpression',
                  start: 23,
                  end: 36,
                  digest: null,
                  callee: {
                    type: 'Identifier',
                    start: 23,
                    end: 29,
                    name: 'myFunc',
                    digest: null,
                  },
                  arguments: [
                    {
                      type: 'Literal',
                      start: 30,
                      end: 32,
                      value: 45,
                      raw: '45',
                      digest: null,
                    },
                    {
                      type: 'PipeSubstitution',
                      start: 34,
                      end: 35,
                      digest: null,
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
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 33,
        kind: 'const',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 33,
            digest: null,
            id: {
              type: 'Identifier',
              start: 6,
              end: 8,
              name: 'yo',
              digest: null,
            },
            init: {
              type: 'ArrayExpression',
              start: 11,
              end: 33,
              digest: null,
              elements: [
                {
                  type: 'Literal',
                  start: 12,
                  end: 13,
                  value: 1,
                  raw: '1',
                  digest: null,
                },
                {
                  type: 'Literal',
                  start: 15,
                  end: 18,
                  value: '2',
                  raw: "'2'",
                  digest: null,
                },
                {
                  type: 'Identifier',
                  start: 20,
                  end: 25,
                  name: 'three',
                  digest: null,
                },
                {
                  type: 'BinaryExpression',
                  start: 27,
                  end: 32,
                  digest: null,
                  left: {
                    type: 'Literal',
                    start: 27,
                    end: 28,
                    value: 4,
                    raw: '4',
                    digest: null,
                  },
                  operator: '+',
                  right: {
                    type: 'Literal',
                    start: 31,
                    end: 32,
                    value: 5,
                    raw: '5',
                    digest: null,
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
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 15,
        kind: 'const',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 15,
            digest: null,
            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              name: 'three',
              digest: null,
            },
            init: {
              type: 'Literal',
              start: 14,
              end: 15,
              value: 3,
              raw: '3',
              digest: null,
            },
          },
        ],
      },
      {
        type: 'VariableDeclaration',
        start: 16,
        end: 83,
        kind: 'const',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 22,
            end: 83,
            digest: null,
            id: {
              type: 'Identifier',
              start: 22,
              end: 24,
              name: 'yo',
              digest: null,
            },
            init: {
              type: 'ObjectExpression',
              start: 27,
              end: 83,
              digest: null,
              properties: [
                {
                  type: 'ObjectProperty',
                  start: 28,
                  end: 39,
                  digest: null,
                  key: {
                    type: 'Identifier',
                    start: 28,
                    end: 32,
                    name: 'aStr',
                    digest: null,
                  },
                  value: {
                    type: 'Literal',
                    start: 34,
                    end: 39,
                    value: 'str',
                    raw: "'str'",
                    digest: null,
                  },
                },
                {
                  type: 'ObjectProperty',
                  start: 41,
                  end: 48,
                  digest: null,
                  key: {
                    type: 'Identifier',
                    start: 41,
                    end: 45,
                    name: 'anum',
                    digest: null,
                  },
                  value: {
                    type: 'Literal',
                    start: 47,
                    end: 48,
                    value: 2,
                    raw: '2',
                    digest: null,
                  },
                },
                {
                  type: 'ObjectProperty',
                  start: 50,
                  end: 67,
                  digest: null,
                  key: {
                    type: 'Identifier',
                    start: 50,
                    end: 60,
                    name: 'identifier',
                    digest: null,
                  },
                  value: {
                    type: 'Identifier',
                    start: 62,
                    end: 67,
                    name: 'three',
                    digest: null,
                  },
                },
                {
                  type: 'ObjectProperty',
                  start: 69,
                  end: 82,
                  digest: null,
                  key: {
                    type: 'Identifier',
                    start: 69,
                    end: 75,
                    name: 'binExp',
                    digest: null,
                  },
                  value: {
                    type: 'BinaryExpression',
                    start: 77,
                    end: 82,
                    digest: null,
                    left: {
                      type: 'Literal',
                      start: 77,
                      end: 78,
                      value: 4,
                      raw: '4',
                      digest: null,
                    },
                    operator: '+',
                    right: {
                      type: 'Literal',
                      start: 81,
                      end: 82,
                      value: 5,
                      raw: '5',
                      digest: null,
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
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 37,
        kind: 'const',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 37,
            digest: null,
            id: {
              type: 'Identifier',
              start: 6,
              end: 8,
              name: 'yo',
              digest: null,
            },
            init: {
              type: 'ObjectExpression',
              start: 11,
              end: 37,
              digest: null,
              properties: [
                {
                  type: 'ObjectProperty',
                  start: 12,
                  end: 36,
                  digest: null,
                  key: {
                    type: 'Identifier',
                    start: 12,
                    end: 15,
                    name: 'key',
                    digest: null,
                  },
                  value: {
                    type: 'ObjectExpression',
                    start: 17,
                    end: 36,
                    digest: null,
                    properties: [
                      {
                        type: 'ObjectProperty',
                        start: 21,
                        end: 34,
                        digest: null,
                        key: {
                          type: 'Identifier',
                          start: 21,
                          end: 25,
                          name: 'key2',
                          digest: null,
                        },
                        value: {
                          type: 'Literal',
                          start: 27,
                          end: 34,
                          value: 'value',
                          raw: "'value'",
                          digest: null,
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
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 26,
        kind: 'const',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 26,
            digest: null,
            id: {
              type: 'Identifier',
              start: 6,
              end: 8,
              name: 'yo',
              digest: null,
            },
            init: {
              type: 'ObjectExpression',
              start: 11,
              end: 26,
              digest: null,
              properties: [
                {
                  type: 'ObjectProperty',
                  start: 12,
                  end: 25,
                  digest: null,
                  key: {
                    type: 'Identifier',
                    start: 12,
                    end: 15,
                    name: 'key',
                    digest: null,
                  },
                  value: {
                    type: 'ArrayExpression',
                    start: 17,
                    end: 25,
                    digest: null,
                    elements: [
                      {
                        type: 'Literal',
                        start: 18,
                        end: 19,
                        value: 1,
                        raw: '1',
                        digest: null,
                      },
                      {
                        type: 'Literal',
                        start: 21,
                        end: 24,
                        value: '2',
                        raw: "'2'",
                        digest: null,
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
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 23,
        kind: 'const',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 23,
            digest: null,
            id: {
              type: 'Identifier',
              start: 6,
              end: 10,
              name: 'prop',
              digest: null,
            },
            init: {
              type: 'MemberExpression',
              start: 13,
              end: 23,
              computed: false,
              digest: null,
              object: {
                type: 'MemberExpression',
                start: 13,
                end: 19,
                digest: null,
                computed: false,
                object: {
                  type: 'Identifier',
                  start: 13,
                  end: 15,
                  name: 'yo',
                  digest: null,
                },
                property: {
                  type: 'Identifier',
                  start: 16,
                  end: 19,
                  name: 'one',
                  digest: null,
                },
              },
              property: {
                type: 'Identifier',
                start: 20,
                end: 23,
                name: 'two',
                digest: null,
              },
            },
          },
        ],
      },
    ])
  })
  test('object memberExpression with square braces', () => {
    const code = `const prop = yo.one["two"]`
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 26,
        kind: 'const',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 26,
            digest: null,
            id: {
              type: 'Identifier',
              start: 6,
              end: 10,
              name: 'prop',
              digest: null,
            },
            init: {
              type: 'MemberExpression',
              start: 13,
              end: 26,
              computed: false,
              digest: null,
              object: {
                type: 'MemberExpression',
                start: 13,
                end: 19,
                computed: false,
                digest: null,
                object: {
                  type: 'Identifier',
                  start: 13,
                  end: 15,
                  name: 'yo',
                  digest: null,
                },
                property: {
                  type: 'Identifier',
                  start: 16,
                  end: 19,
                  name: 'one',
                  digest: null,
                },
              },
              property: {
                type: 'Literal',
                start: 20,
                end: 25,
                value: 'two',
                raw: '"two"',
                digest: null,
              },
            },
          },
        ],
      },
    ])
  })
  test('object memberExpression with two square braces literal and identifier', () => {
    const code = `const prop = yo["one"][two]`
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 27,
        kind: 'const',
        digest: null,
        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 27,
            digest: null,
            id: {
              type: 'Identifier',
              start: 6,
              end: 10,
              name: 'prop',
              digest: null,
            },
            init: {
              type: 'MemberExpression',
              start: 13,
              end: 27,
              computed: true,
              digest: null,
              object: {
                type: 'MemberExpression',
                start: 13,
                end: 22,
                digest: null,
                computed: false,
                object: {
                  type: 'Identifier',
                  start: 13,
                  end: 15,
                  name: 'yo',
                  digest: null,
                },
                property: {
                  type: 'Literal',
                  start: 16,
                  end: 21,
                  value: 'one',
                  raw: '"one"',
                  digest: null,
                },
              },
              property: {
                type: 'Identifier',
                start: 23,
                end: 26,
                name: 'two',
                digest: null,
              },
            },
          },
        ],
      },
    ])
  })
})

describe('nests binary expressions correctly', () => {
  it('works with the simple case', () => {
    const code = `const yo = 1 + 2`
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body[0]).toEqual({
      type: 'VariableDeclaration',
      start: 0,
      end: 16,
      kind: 'const',
      digest: null,
      declarations: [
        {
          type: 'VariableDeclarator',
          start: 6,
          end: 16,
          digest: null,
          id: {
            type: 'Identifier',
            start: 6,
            end: 8,
            name: 'yo',
            digest: null,
          },
          init: {
            type: 'BinaryExpression',
            start: 11,
            end: 16,
            digest: null,
            left: {
              type: 'Literal',
              start: 11,
              end: 12,
              value: 1,
              raw: '1',
              digest: null,
            },
            operator: '+',
            right: {
              type: 'Literal',
              start: 15,
              end: 16,
              value: 2,
              raw: '2',
              digest: null,
            },
          },
        },
      ],
    })
  })
  it('should nest according to precedence with multiply first', () => {
    // should be binExp { binExp { lit-1 * lit-2 } + lit}
    const code = `const yo = 1 * 2 + 3`
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body[0]).toEqual({
      type: 'VariableDeclaration',
      start: 0,
      end: 20,
      kind: 'const',
      digest: null,
      declarations: [
        {
          type: 'VariableDeclarator',
          start: 6,
          end: 20,
          digest: null,
          id: {
            type: 'Identifier',
            start: 6,
            end: 8,
            name: 'yo',
            digest: null,
          },
          init: {
            type: 'BinaryExpression',
            start: 11,
            end: 20,
            digest: null,
            left: {
              type: 'BinaryExpression',
              start: 11,
              end: 16,
              digest: null,
              left: {
                type: 'Literal',
                start: 11,
                end: 12,
                value: 1,
                raw: '1',
                digest: null,
              },
              operator: '*',
              right: {
                type: 'Literal',
                start: 15,
                end: 16,
                value: 2,
                raw: '2',
                digest: null,
              },
            },
            operator: '+',
            right: {
              type: 'Literal',
              start: 19,
              end: 20,
              value: 3,
              raw: '3',
              digest: null,
            },
          },
        },
      ],
    })
  })
  it('should nest according to precedence with sum first', () => {
    // should be binExp { lit-1 + binExp { lit-2 * lit-3 } }
    const code = `const yo = 1 + 2 * 3`
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body[0]).toEqual({
      type: 'VariableDeclaration',
      start: 0,
      end: 20,
      kind: 'const',
      digest: null,
      declarations: [
        {
          type: 'VariableDeclarator',
          start: 6,
          end: 20,
          digest: null,
          id: {
            type: 'Identifier',
            start: 6,
            end: 8,
            name: 'yo',
            digest: null,
          },
          init: {
            type: 'BinaryExpression',
            start: 11,
            end: 20,
            digest: null,
            left: {
              type: 'Literal',
              start: 11,
              end: 12,
              value: 1,
              raw: '1',
              digest: null,
            },
            operator: '+',
            right: {
              type: 'BinaryExpression',
              start: 15,
              end: 20,
              digest: null,
              left: {
                type: 'Literal',
                start: 15,
                end: 16,
                value: 2,
                raw: '2',
                digest: null,
              },
              operator: '*',
              right: {
                type: 'Literal',
                start: 19,
                end: 20,
                value: 3,
                raw: '3',
                digest: null,
              },
            },
          },
        },
      ],
    })
  })
  it('should nest properly with two operators of equal precedence', () => {
    const code = `const yo = 1 + 2 - 3`
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect((body[0] as any).declarations[0].init).toEqual({
      type: 'BinaryExpression',
      start: 11,
      end: 20,
      digest: null,
      left: {
        type: 'BinaryExpression',
        start: 11,
        end: 16,
        digest: null,
        left: {
          type: 'Literal',
          start: 11,
          end: 12,
          value: 1,
          raw: '1',
          digest: null,
        },
        operator: '+',
        right: {
          type: 'Literal',
          start: 15,
          end: 16,
          value: 2,
          raw: '2',
          digest: null,
        },
      },
      operator: '-',
      right: {
        type: 'Literal',
        start: 19,
        end: 20,
        value: 3,
        raw: '3',
        digest: null,
      },
    })
  })
  it('should nest properly with two operators of equal (but higher) precedence', () => {
    const code = `const yo = 1 * 2 / 3`
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect((body[0] as any).declarations[0].init).toEqual({
      type: 'BinaryExpression',
      start: 11,
      end: 20,
      digest: null,
      left: {
        type: 'BinaryExpression',
        start: 11,
        end: 16,
        digest: null,
        left: {
          type: 'Literal',
          start: 11,
          end: 12,
          value: 1,
          raw: '1',
          digest: null,
        },
        operator: '*',
        right: {
          type: 'Literal',
          start: 15,
          end: 16,
          value: 2,
          raw: '2',
          digest: null,
        },
      },
      operator: '/',
      right: {
        type: 'Literal',
        start: 19,
        end: 20,
        value: 3,
        raw: '3',
        digest: null,
      },
    })
  })
  it('should nest properly with longer example', () => {
    const code = `const yo = 1 + 2 * (3 - 4) / 5 + 6`
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    const init = (body[0] as any).declarations[0].init
    expect(init).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      start: 11,
      end: 34,
      digest: null,
      left: {
        type: 'BinaryExpression',
        operator: '+',
        start: 11,
        end: 30,
        digest: null,
        left: {
          type: 'Literal',
          value: 1,
          raw: '1',
          start: 11,
          end: 12,
          digest: null,
        },
        right: {
          type: 'BinaryExpression',
          operator: '/',
          start: 15,
          end: 30,
          digest: null,
          left: {
            type: 'BinaryExpression',
            operator: '*',
            start: 15,
            end: 25,
            digest: null,
            left: {
              type: 'Literal',
              value: 2,
              raw: '2',
              start: 15,
              end: 16,
              digest: null,
            },
            right: {
              type: 'BinaryExpression',
              operator: '-',
              start: 20,
              end: 25,
              digest: null,
              left: {
                type: 'Literal',
                value: 3,
                raw: '3',
                start: 20,
                end: 21,
                digest: null,
              },
              right: {
                type: 'Literal',
                value: 4,
                raw: '4',
                start: 24,
                end: 25,
                digest: null,
              },
            },
          },
          right: {
            type: 'Literal',
            value: 5,
            raw: '5',
            start: 29,
            end: 30,
            digest: null,
          },
        },
      },
      right: {
        type: 'Literal',
        value: 6,
        raw: '6',
        start: 33,
        end: 34,
        digest: null,
      },
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
      type: 'NonCodeNode',
      start: code.indexOf('\n// this is a comment'),
      end: code.indexOf('const key') - 1,
      digest: null,
      value: {
        type: 'blockComment',
        style: 'line',
        value: 'this is a comment',
      },
    }
    const ast = parse(code)
    if (err(ast)) throw ast
    const { nonCodeMeta } = ast
    expect(nonCodeMeta.nonCodeNodes[0][0]).toEqual(nonCodeMetaInstance)

    // extra whitespace won't change it's position (0) or value (NB the start end would have changed though)
    const codeWithExtraStartWhitespace = '\n\n\n' + code
    const ast2 = parse(codeWithExtraStartWhitespace)
    if (err(ast2)) throw ast2
    const { nonCodeMeta: nonCodeMeta2 } = ast2
    expect(nonCodeMeta2.nonCodeNodes[0][0].value).toStrictEqual(
      nonCodeMetaInstance.value
    )
    expect(nonCodeMeta2.nonCodeNodes[0][0].start).not.toBe(
      nonCodeMetaInstance.start
    )
  })
  it('comments nested within a block statement', () => {
    const code = `const mySketch = startSketchAt([0,0])
  |> lineTo([0, 1], %, 'myPath')
  |> lineTo([1, 1], %) /* this is
      a comment
      spanning a few lines */
  |> lineTo([1,0], %, "rightPath")
  |> close(%)
`

    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    const indexOfSecondLineToExpression = 2
    const sketchNonCodeMeta = (body as any)[0].declarations[0].init.nonCodeMeta
      .nonCodeNodes
    expect(sketchNonCodeMeta[indexOfSecondLineToExpression][0]).toEqual({
      type: 'NonCodeNode',
      start: 93,
      end: 150,
      digest: null,
      value: {
        type: 'inlineComment',
        style: 'block',
        value: 'this is\n      a comment\n      spanning a few lines',
      },
    })
  })
  it('comments in a pipe expression', () => {
    const code = [
      'const mySk1 = startSketchAt([0, 0])',
      '  |> lineTo([1, 1], %)',
      '  |> lineTo([0, 1], %, "myPath")',
      '  |> lineTo([1, 1], %)',
      '// a comment',
      '  |> rx(90, %)',
    ].join('\n')

    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    const sketchNonCodeMeta = (body[0] as any).declarations[0].init.nonCodeMeta
      .nonCodeNodes[3][0]
    expect(sketchNonCodeMeta).toEqual({
      type: 'NonCodeNode',
      start: 114,
      end: 127,
      digest: null,
      value: {
        type: 'blockComment',
        value: 'a comment',
        style: 'line',
      },
    })
  })
})

describe('test UnaryExpression', () => {
  it('should parse a unary expression in simple var dec situation', () => {
    const code = `const myVar = -min(4, 100)`
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    const myVarInit = (body?.[0] as any).declarations[0]?.init
    expect(myVarInit).toEqual({
      type: 'UnaryExpression',
      operator: '-',
      start: 14,
      end: 26,
      digest: null,
      argument: {
        type: 'CallExpression',
        start: 15,
        end: 26,
        digest: null,
        callee: {
          type: 'Identifier',
          start: 15,
          end: 18,
          name: 'min',
          digest: null,
        },
        arguments: [
          {
            type: 'Literal',
            start: 19,
            end: 20,
            value: 4,
            raw: '4',
            digest: null,
          },
          {
            type: 'Literal',
            start: 22,
            end: 25,
            value: 100,
            raw: '100',
            digest: null,
          },
        ],
        optional: false,
      },
    })
  })
})

describe('testing nested call expressions', () => {
  it('callExp in a binExp in a callExp', () => {
    const code = 'const myVar = min(100, 1 + legLen(5, 3))'
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    const myVarInit = (body?.[0] as any).declarations[0]?.init
    expect(myVarInit).toEqual({
      type: 'CallExpression',
      start: 14,
      end: 40,
      digest: null,
      callee: {
        type: 'Identifier',
        start: 14,
        end: 17,
        name: 'min',
        digest: null,
      },
      arguments: [
        {
          type: 'Literal',
          start: 18,
          end: 21,
          value: 100,
          raw: '100',
          digest: null,
        },
        {
          type: 'BinaryExpression',
          operator: '+',
          start: 23,
          end: 39,
          digest: null,
          left: {
            type: 'Literal',
            value: 1,
            raw: '1',
            start: 23,
            end: 24,
            digest: null,
          },
          right: {
            type: 'CallExpression',
            start: 27,
            end: 39,
            digest: null,
            callee: {
              type: 'Identifier',
              start: 27,
              end: 33,
              name: 'legLen',
              digest: null,
            },
            arguments: [
              {
                type: 'Literal',
                start: 34,
                end: 35,
                value: 5,
                raw: '5',
                digest: null,
              },
              {
                type: 'Literal',
                start: 37,
                end: 38,
                value: 3,
                raw: '3',
                digest: null,
              },
            ],
            optional: false,
          },
        },
      ],
      optional: false,
    })
  })
})

describe('should recognise callExpresions in binaryExpressions', () => {
  const code = "xLineTo(segEndX('seg02', %) + 1, %)"
  it('should recognise the callExp', () => {
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    const callExpArgs = (body?.[0] as any).expression?.arguments
    expect(callExpArgs).toEqual([
      {
        type: 'BinaryExpression',
        operator: '+',
        start: 8,
        end: 31,
        digest: null,
        left: {
          type: 'CallExpression',
          start: 8,
          end: 27,
          digest: null,
          callee: {
            type: 'Identifier',
            start: 8,
            end: 15,
            name: 'segEndX',
            digest: null,
          },
          arguments: [
            {
              type: 'Identifier',
              start: 16,
              end: 23,
              name: 'seg02',
              digest: null,
            },
            { type: 'PipeSubstitution', start: 25, end: 26, digest: null },
          ],
          optional: false,
        },
        right: {
          type: 'Literal',
          value: 1,
          raw: '1',
          start: 30,
          end: 31,
          digest: null,
        },
      },
      { type: 'PipeSubstitution', start: 33, end: 34, digest: null },
    ])
  })
})

describe('parsing errors', () => {
  it('should return an error when there is a unexpected closed curly brace', async () => {
    const code = `const myVar = startSketchAt([}], %)`
    const result = parse(code)

    expect(result).toBeInstanceOf(KCLError)
    const error = result as KCLError
    expect(error.kind).toBe('syntax')
    expect(error.msg).toBe('Unexpected token')
    expect(error.sourceRanges).toEqual([[27, 28]])
  })
})
