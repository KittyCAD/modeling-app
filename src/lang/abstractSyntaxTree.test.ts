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
        moduleId: 0,

        expression: {
          type: 'BinaryExpression',
          start: 0,
          end: 4,
          moduleId: 0,

          left: {
            type: 'Literal',
            start: 0,
            end: 1,
            moduleId: 0,
            value: 5,
            raw: '5',
          },
          operator: '+',
          right: {
            type: 'Literal',
            start: 3,
            end: 4,
            moduleId: 0,
            value: 6,
            raw: '6',
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
        moduleId: 0,
        kind: 'const',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 15,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              moduleId: 0,
              name: 'myVar',
            },
            init: {
              type: 'Literal',
              start: 14,
              end: 15,
              moduleId: 0,
              value: 5,
              raw: '5',
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
        moduleId: 0,
        kind: 'const',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 15,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              moduleId: 0,
              name: 'myVar',
            },
            init: {
              type: 'Literal',
              start: 14,
              end: 15,
              moduleId: 0,
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
        moduleId: 0,
        kind: 'const',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 22,
            end: 40,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 22,
              end: 28,
              moduleId: 0,
              name: 'newVar',
            },
            init: {
              type: 'BinaryExpression',
              start: 31,
              end: 40,
              moduleId: 0,
              left: {
                type: 'Identifier',
                start: 31,
                end: 36,
                moduleId: 0,
                name: 'myVar',
              },
              operator: '+',
              right: {
                type: 'Literal',
                start: 39,
                end: 40,
                moduleId: 0,
                value: 1,
                raw: '1',
              },
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
        moduleId: 0,
        kind: 'fn',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 3,
            end: 39,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 3,
              end: 8,
              moduleId: 0,
              name: 'funcN',
            },
            init: {
              type: 'FunctionExpression',
              start: 11,
              end: 39,
              moduleId: 0,

              params: [
                {
                  type: 'Parameter',
                  identifier: {
                    type: 'Identifier',
                    start: 12,
                    end: 13,
                    moduleId: 0,
                    name: 'a',
                  },
                  optional: false,
                },
                {
                  type: 'Parameter',
                  identifier: {
                    type: 'Identifier',
                    start: 15,
                    end: 16,
                    moduleId: 0,
                    name: 'b',
                  },
                  optional: false,
                },
              ],
              body: {
                start: 21,
                end: 39,
                moduleId: 0,

                body: [
                  {
                    type: 'ReturnStatement',
                    start: 25,
                    end: 37,
                    moduleId: 0,

                    argument: {
                      type: 'BinaryExpression',
                      start: 32,
                      end: 37,
                      moduleId: 0,

                      left: {
                        type: 'Identifier',
                        start: 32,
                        end: 33,
                        moduleId: 0,
                        name: 'a',
                      },
                      operator: '+',
                      right: {
                        type: 'Identifier',
                        start: 36,
                        end: 37,
                        moduleId: 0,
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
        moduleId: 0,
        kind: 'fn',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 3,
            end: 37,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 3,
              end: 8,
              moduleId: 0,
              name: 'funcN',
            },
            init: {
              type: 'FunctionExpression',
              start: 11,
              end: 37,
              moduleId: 0,

              params: [
                {
                  type: 'Parameter',
                  identifier: {
                    type: 'Identifier',
                    start: 12,
                    end: 13,
                    moduleId: 0,
                    name: 'a',
                  },
                  optional: false,
                },
                {
                  type: 'Parameter',
                  identifier: {
                    type: 'Identifier',
                    start: 15,
                    end: 16,
                    moduleId: 0,
                    name: 'b',
                  },
                  optional: false,
                },
              ],
              body: {
                start: 21,
                end: 37,
                moduleId: 0,

                body: [
                  {
                    type: 'ReturnStatement',
                    start: 23,
                    end: 35,
                    moduleId: 0,

                    argument: {
                      type: 'BinaryExpression',
                      start: 30,
                      end: 35,
                      moduleId: 0,

                      left: {
                        type: 'Identifier',
                        start: 30,
                        end: 31,
                        moduleId: 0,

                        name: 'a',
                      },
                      operator: '+',
                      right: {
                        type: 'Identifier',
                        start: 34,
                        end: 35,
                        moduleId: 0,

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
        moduleId: 0,
        kind: 'const',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 44,
            end: 63,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 44,
              end: 49,
              moduleId: 0,
              name: 'myVar',
            },
            init: {
              type: 'CallExpression',
              start: 52,
              end: 63,
              moduleId: 0,

              callee: {
                type: 'Identifier',
                start: 52,
                end: 57,
                moduleId: 0,
                name: 'funcN',
              },
              arguments: [
                {
                  type: 'Literal',
                  start: 58,
                  end: 59,
                  moduleId: 0,
                  value: 1,
                  raw: '1',
                },
                {
                  type: 'Literal',
                  start: 61,
                  end: 62,
                  moduleId: 0,
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

describe('testing pipe operator special', () => {
  test('pipe operator with sketch', () => {
    let code = `const mySketch = startSketchAt([0, 0])
  |> lineTo([2, 3], %)
  |> lineTo([0, 1], %, $myPath)
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
        end: 131,
        moduleId: 0,
        kind: 'const',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 131,
            moduleId: 0,
            id: {
              type: 'Identifier',
              start: 6,
              end: 14,
              moduleId: 0,
              name: 'mySketch',
            },

            init: {
              type: 'PipeExpression',
              start: 17,
              end: 131,
              moduleId: 0,

              body: [
                {
                  type: 'CallExpression',
                  start: 17,
                  end: 38,
                  moduleId: 0,

                  callee: {
                    type: 'Identifier',
                    start: 17,
                    end: 30,
                    moduleId: 0,
                    name: 'startSketchAt',
                  },
                  arguments: [
                    {
                      type: 'ArrayExpression',
                      start: 31,
                      end: 37,
                      moduleId: 0,

                      elements: [
                        {
                          type: 'Literal',
                          start: 32,
                          end: 33,
                          moduleId: 0,
                          value: 0,
                          raw: '0',
                        },
                        {
                          type: 'Literal',
                          start: 35,
                          end: 36,
                          moduleId: 0,
                          value: 0,
                          raw: '0',
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
                  moduleId: 0,

                  callee: {
                    type: 'Identifier',
                    start: 44,
                    end: 50,
                    moduleId: 0,

                    name: 'lineTo',
                  },
                  arguments: [
                    {
                      type: 'ArrayExpression',
                      start: 51,
                      end: 57,
                      moduleId: 0,

                      elements: [
                        {
                          type: 'Literal',
                          start: 52,
                          end: 53,
                          moduleId: 0,
                          value: 2,
                          raw: '2',
                        },
                        {
                          type: 'Literal',
                          start: 55,
                          end: 56,
                          moduleId: 0,
                          value: 3,
                          raw: '3',
                        },
                      ],
                    },
                    {
                      type: 'PipeSubstitution',
                      start: 59,
                      end: 60,
                      moduleId: 0,
                    },
                  ],
                  optional: false,
                },
                {
                  type: 'CallExpression',
                  start: 67,
                  end: 93,
                  moduleId: 0,

                  callee: {
                    type: 'Identifier',
                    start: 67,
                    end: 73,
                    moduleId: 0,
                    name: 'lineTo',
                  },
                  arguments: [
                    {
                      type: 'ArrayExpression',
                      start: 74,
                      end: 80,
                      moduleId: 0,

                      elements: [
                        {
                          type: 'Literal',
                          start: 75,
                          end: 76,
                          moduleId: 0,
                          value: 0,
                          raw: '0',
                        },
                        {
                          type: 'Literal',
                          start: 78,
                          end: 79,
                          moduleId: 0,
                          value: 1,
                          raw: '1',
                        },
                      ],
                    },
                    {
                      type: 'PipeSubstitution',
                      start: 82,
                      end: 83,
                      moduleId: 0,
                    },
                    {
                      type: 'TagDeclarator',
                      start: 85,
                      end: 92,
                      moduleId: 0,
                      value: 'myPath',
                    },
                  ],
                  optional: false,
                },
                {
                  type: 'CallExpression',
                  start: 99,
                  end: 116,
                  moduleId: 0,

                  callee: {
                    type: 'Identifier',
                    start: 99,
                    end: 105,
                    moduleId: 0,
                    name: 'lineTo',
                  },
                  arguments: [
                    {
                      type: 'ArrayExpression',
                      start: 106,
                      end: 112,
                      moduleId: 0,

                      elements: [
                        {
                          type: 'Literal',
                          start: 107,
                          end: 108,
                          moduleId: 0,
                          value: 1,
                          raw: '1',
                        },
                        {
                          type: 'Literal',
                          start: 110,
                          end: 111,
                          moduleId: 0,
                          value: 1,
                          raw: '1',
                        },
                      ],
                    },
                    {
                      type: 'PipeSubstitution',
                      start: 114,
                      end: 115,
                      moduleId: 0,
                    },
                  ],
                  optional: false,
                },
                {
                  type: 'CallExpression',
                  start: 122,
                  end: 131,
                  moduleId: 0,

                  callee: {
                    type: 'Identifier',
                    start: 122,
                    end: 124,
                    moduleId: 0,
                    name: 'rx',
                  },
                  arguments: [
                    {
                      type: 'Literal',
                      start: 125,
                      end: 127,
                      moduleId: 0,
                      value: 45,
                      raw: '45',
                    },
                    {
                      type: 'PipeSubstitution',
                      start: 129,
                      end: 130,
                      moduleId: 0,
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
        moduleId: 0,
        kind: 'const',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 36,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              moduleId: 0,
              name: 'myVar',
            },
            init: {
              type: 'PipeExpression',
              start: 14,
              end: 36,
              moduleId: 0,

              body: [
                {
                  type: 'BinaryExpression',
                  start: 14,
                  end: 19,
                  moduleId: 0,

                  left: {
                    type: 'Literal',
                    start: 14,
                    end: 15,
                    moduleId: 0,
                    value: 5,
                    raw: '5',
                  },
                  operator: '+',
                  right: {
                    type: 'Literal',
                    start: 18,
                    end: 19,
                    moduleId: 0,
                    value: 6,
                    raw: '6',
                  },
                },
                {
                  type: 'CallExpression',
                  start: 23,
                  end: 36,
                  moduleId: 0,

                  callee: {
                    type: 'Identifier',
                    start: 23,
                    end: 29,
                    moduleId: 0,
                    name: 'myFunc',
                  },
                  arguments: [
                    {
                      type: 'Literal',
                      start: 30,
                      end: 32,
                      moduleId: 0,
                      value: 45,
                      raw: '45',
                    },
                    {
                      type: 'PipeSubstitution',
                      start: 34,
                      end: 35,
                      moduleId: 0,
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
        moduleId: 0,
        kind: 'const',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 33,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 6,
              end: 8,
              moduleId: 0,
              name: 'yo',
            },
            init: {
              type: 'ArrayExpression',
              start: 11,
              end: 33,
              moduleId: 0,

              elements: [
                {
                  type: 'Literal',
                  start: 12,
                  end: 13,
                  moduleId: 0,
                  value: 1,
                  raw: '1',
                },
                {
                  type: 'Literal',
                  start: 15,
                  end: 18,
                  moduleId: 0,
                  value: '2',
                  raw: "'2'",
                },
                {
                  type: 'Identifier',
                  start: 20,
                  end: 25,
                  moduleId: 0,
                  name: 'three',
                },
                {
                  type: 'BinaryExpression',
                  start: 27,
                  end: 32,
                  moduleId: 0,

                  left: {
                    type: 'Literal',
                    start: 27,
                    end: 28,
                    moduleId: 0,
                    value: 4,
                    raw: '4',
                  },
                  operator: '+',
                  right: {
                    type: 'Literal',
                    start: 31,
                    end: 32,
                    moduleId: 0,
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
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 15,
        moduleId: 0,
        kind: 'const',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 15,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 6,
              end: 11,
              moduleId: 0,
              name: 'three',
            },
            init: {
              type: 'Literal',
              start: 14,
              end: 15,
              moduleId: 0,
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
        moduleId: 0,
        kind: 'const',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 22,
            end: 83,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 22,
              end: 24,
              moduleId: 0,
              name: 'yo',
            },
            init: {
              type: 'ObjectExpression',
              start: 27,
              end: 83,
              moduleId: 0,

              properties: [
                {
                  type: 'ObjectProperty',
                  start: 28,
                  end: 39,
                  moduleId: 0,

                  key: {
                    type: 'Identifier',
                    start: 28,
                    end: 32,
                    moduleId: 0,
                    name: 'aStr',
                  },
                  value: {
                    type: 'Literal',
                    start: 34,
                    end: 39,
                    moduleId: 0,
                    value: 'str',
                    raw: "'str'",
                  },
                },
                {
                  type: 'ObjectProperty',
                  start: 41,
                  end: 48,
                  moduleId: 0,

                  key: {
                    type: 'Identifier',
                    start: 41,
                    end: 45,
                    moduleId: 0,
                    name: 'anum',
                  },
                  value: {
                    type: 'Literal',
                    start: 47,
                    end: 48,
                    moduleId: 0,
                    value: 2,
                    raw: '2',
                  },
                },
                {
                  type: 'ObjectProperty',
                  start: 50,
                  end: 67,
                  moduleId: 0,

                  key: {
                    type: 'Identifier',
                    start: 50,
                    end: 60,
                    moduleId: 0,
                    name: 'identifier',
                  },
                  value: {
                    type: 'Identifier',
                    start: 62,
                    end: 67,
                    moduleId: 0,
                    name: 'three',
                  },
                },
                {
                  type: 'ObjectProperty',
                  start: 69,
                  end: 82,
                  moduleId: 0,

                  key: {
                    type: 'Identifier',
                    start: 69,
                    end: 75,
                    moduleId: 0,
                    name: 'binExp',
                  },
                  value: {
                    type: 'BinaryExpression',
                    start: 77,
                    end: 82,
                    moduleId: 0,

                    left: {
                      type: 'Literal',
                      start: 77,
                      end: 78,
                      moduleId: 0,
                      value: 4,
                      raw: '4',
                    },
                    operator: '+',
                    right: {
                      type: 'Literal',
                      start: 81,
                      end: 82,
                      moduleId: 0,
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
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 37,
        moduleId: 0,
        kind: 'const',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 37,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 6,
              end: 8,
              moduleId: 0,
              name: 'yo',
            },
            init: {
              type: 'ObjectExpression',
              start: 11,
              end: 37,
              moduleId: 0,

              properties: [
                {
                  type: 'ObjectProperty',
                  start: 12,
                  end: 36,
                  moduleId: 0,

                  key: {
                    type: 'Identifier',
                    start: 12,
                    end: 15,
                    moduleId: 0,
                    name: 'key',
                  },
                  value: {
                    type: 'ObjectExpression',
                    start: 17,
                    end: 36,
                    moduleId: 0,

                    properties: [
                      {
                        type: 'ObjectProperty',
                        start: 21,
                        end: 34,
                        moduleId: 0,

                        key: {
                          type: 'Identifier',
                          start: 21,
                          end: 25,
                          moduleId: 0,
                          name: 'key2',
                        },
                        value: {
                          type: 'Literal',
                          start: 27,
                          end: 34,
                          moduleId: 0,
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
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 26,
        moduleId: 0,
        kind: 'const',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 26,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 6,
              end: 8,
              moduleId: 0,
              name: 'yo',
            },
            init: {
              type: 'ObjectExpression',
              start: 11,
              end: 26,
              moduleId: 0,

              properties: [
                {
                  type: 'ObjectProperty',
                  start: 12,
                  end: 25,
                  moduleId: 0,

                  key: {
                    type: 'Identifier',
                    start: 12,
                    end: 15,
                    moduleId: 0,
                    name: 'key',
                  },
                  value: {
                    type: 'ArrayExpression',
                    start: 17,
                    end: 25,
                    moduleId: 0,

                    elements: [
                      {
                        type: 'Literal',
                        start: 18,
                        end: 19,
                        moduleId: 0,
                        value: 1,
                        raw: '1',
                      },
                      {
                        type: 'Literal',
                        start: 21,
                        end: 24,
                        moduleId: 0,
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
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 23,
        moduleId: 0,
        kind: 'const',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 23,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 6,
              end: 10,
              moduleId: 0,
              name: 'prop',
            },
            init: {
              type: 'MemberExpression',
              start: 13,
              end: 23,
              moduleId: 0,
              computed: false,

              object: {
                type: 'MemberExpression',
                start: 13,
                end: 19,
                moduleId: 0,

                computed: false,
                object: {
                  type: 'Identifier',
                  start: 13,
                  end: 15,
                  moduleId: 0,
                  name: 'yo',
                },
                property: {
                  type: 'Identifier',
                  start: 16,
                  end: 19,
                  moduleId: 0,
                  name: 'one',
                },
              },
              property: {
                type: 'Identifier',
                start: 20,
                end: 23,
                moduleId: 0,
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
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 26,
        moduleId: 0,
        kind: 'const',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 26,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 6,
              end: 10,
              moduleId: 0,
              name: 'prop',
            },
            init: {
              type: 'MemberExpression',
              start: 13,
              end: 26,
              moduleId: 0,
              computed: false,

              object: {
                type: 'MemberExpression',
                start: 13,
                end: 19,
                moduleId: 0,
                computed: false,

                object: {
                  type: 'Identifier',
                  start: 13,
                  end: 15,
                  moduleId: 0,
                  name: 'yo',
                },
                property: {
                  type: 'Identifier',
                  start: 16,
                  end: 19,
                  moduleId: 0,
                  name: 'one',
                },
              },
              property: {
                type: 'Literal',
                start: 20,
                end: 25,
                moduleId: 0,
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
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body).toEqual([
      {
        type: 'VariableDeclaration',
        start: 0,
        end: 27,
        moduleId: 0,
        kind: 'const',

        declarations: [
          {
            type: 'VariableDeclarator',
            start: 6,
            end: 27,
            moduleId: 0,

            id: {
              type: 'Identifier',
              start: 6,
              end: 10,
              moduleId: 0,
              name: 'prop',
            },
            init: {
              type: 'MemberExpression',
              start: 13,
              end: 27,
              moduleId: 0,
              computed: true,

              object: {
                type: 'MemberExpression',
                start: 13,
                end: 22,
                moduleId: 0,

                computed: false,
                object: {
                  type: 'Identifier',
                  start: 13,
                  end: 15,
                  moduleId: 0,
                  name: 'yo',
                },
                property: {
                  type: 'Literal',
                  start: 16,
                  end: 21,
                  moduleId: 0,
                  value: 'one',
                  raw: '"one"',
                },
              },
              property: {
                type: 'Identifier',
                start: 23,
                end: 26,
                moduleId: 0,
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
  it('works with the simple case', () => {
    const code = `const yo = 1 + 2`
    const ast = parse(code)
    if (err(ast)) throw ast
    const { body } = ast
    expect(body[0]).toEqual({
      type: 'VariableDeclaration',
      start: 0,
      end: 16,
      moduleId: 0,
      kind: 'const',

      declarations: [
        {
          type: 'VariableDeclarator',
          start: 6,
          end: 16,
          moduleId: 0,

          id: {
            type: 'Identifier',
            start: 6,
            end: 8,
            moduleId: 0,
            name: 'yo',
          },
          init: {
            type: 'BinaryExpression',
            start: 11,
            end: 16,
            moduleId: 0,

            left: {
              type: 'Literal',
              start: 11,
              end: 12,
              moduleId: 0,
              value: 1,
              raw: '1',
            },
            operator: '+',
            right: {
              type: 'Literal',
              start: 15,
              end: 16,
              moduleId: 0,
              value: 2,
              raw: '2',
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
      moduleId: 0,
      kind: 'const',

      declarations: [
        {
          type: 'VariableDeclarator',
          start: 6,
          end: 20,
          moduleId: 0,

          id: {
            type: 'Identifier',
            start: 6,
            end: 8,
            moduleId: 0,
            name: 'yo',
          },
          init: {
            type: 'BinaryExpression',
            start: 11,
            end: 20,
            moduleId: 0,

            left: {
              type: 'BinaryExpression',
              start: 11,
              end: 16,
              moduleId: 0,

              left: {
                type: 'Literal',
                start: 11,
                end: 12,
                moduleId: 0,
                value: 1,
                raw: '1',
              },
              operator: '*',
              right: {
                type: 'Literal',
                start: 15,
                end: 16,
                moduleId: 0,
                value: 2,
                raw: '2',
              },
            },
            operator: '+',
            right: {
              type: 'Literal',
              start: 19,
              end: 20,
              moduleId: 0,
              value: 3,
              raw: '3',
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
      moduleId: 0,
      kind: 'const',

      declarations: [
        {
          type: 'VariableDeclarator',
          start: 6,
          end: 20,
          moduleId: 0,

          id: {
            type: 'Identifier',
            start: 6,
            end: 8,
            moduleId: 0,
            name: 'yo',
          },
          init: {
            type: 'BinaryExpression',
            start: 11,
            end: 20,
            moduleId: 0,

            left: {
              type: 'Literal',
              start: 11,
              end: 12,
              moduleId: 0,
              value: 1,
              raw: '1',
            },
            operator: '+',
            right: {
              type: 'BinaryExpression',
              start: 15,
              end: 20,
              moduleId: 0,

              left: {
                type: 'Literal',
                start: 15,
                end: 16,
                moduleId: 0,
                value: 2,
                raw: '2',
              },
              operator: '*',
              right: {
                type: 'Literal',
                start: 19,
                end: 20,
                moduleId: 0,
                value: 3,
                raw: '3',
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
      moduleId: 0,

      left: {
        type: 'BinaryExpression',
        start: 11,
        end: 16,
        moduleId: 0,

        left: {
          type: 'Literal',
          start: 11,
          end: 12,
          moduleId: 0,
          value: 1,
          raw: '1',
        },
        operator: '+',
        right: {
          type: 'Literal',
          start: 15,
          end: 16,
          moduleId: 0,
          value: 2,
          raw: '2',
        },
      },
      operator: '-',
      right: {
        type: 'Literal',
        start: 19,
        end: 20,
        moduleId: 0,
        value: 3,
        raw: '3',
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
      moduleId: 0,

      left: {
        type: 'BinaryExpression',
        start: 11,
        end: 16,
        moduleId: 0,

        left: {
          type: 'Literal',
          start: 11,
          end: 12,
          moduleId: 0,
          value: 1,
          raw: '1',
        },
        operator: '*',
        right: {
          type: 'Literal',
          start: 15,
          end: 16,
          moduleId: 0,
          value: 2,
          raw: '2',
        },
      },
      operator: '/',
      right: {
        type: 'Literal',
        start: 19,
        end: 20,
        moduleId: 0,
        value: 3,
        raw: '3',
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
      moduleId: 0,

      left: {
        type: 'BinaryExpression',
        operator: '+',
        start: 11,
        end: 30,
        moduleId: 0,

        left: {
          type: 'Literal',
          value: 1,
          raw: '1',
          start: 11,
          end: 12,
          moduleId: 0,
        },
        right: {
          type: 'BinaryExpression',
          operator: '/',
          start: 15,
          end: 30,
          moduleId: 0,

          left: {
            type: 'BinaryExpression',
            operator: '*',
            start: 15,
            end: 25,
            moduleId: 0,

            left: {
              type: 'Literal',
              value: 2,
              raw: '2',
              start: 15,
              end: 16,
              moduleId: 0,
            },
            right: {
              type: 'BinaryExpression',
              operator: '-',
              start: 20,
              end: 25,
              moduleId: 0,

              left: {
                type: 'Literal',
                value: 3,
                raw: '3',
                start: 20,
                end: 21,
                moduleId: 0,
              },
              right: {
                type: 'Literal',
                value: 4,
                raw: '4',
                start: 24,
                end: 25,
                moduleId: 0,
              },
            },
          },
          right: {
            type: 'Literal',
            value: 5,
            raw: '5',
            start: 29,
            end: 30,
            moduleId: 0,
          },
        },
      },
      right: {
        type: 'Literal',
        value: 6,
        raw: '6',
        start: 33,
        end: 34,
        moduleId: 0,
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
      moduleId: 0,

      value: {
        type: 'blockComment',
        style: 'line',
        value: 'this is a comment',
      },
    }
    const ast = parse(code)
    if (err(ast)) throw ast
    const { nonCodeMeta } = ast
    expect(nonCodeMeta.nonCodeNodes[0]?.[0]).toEqual(nonCodeMetaInstance)

    // extra whitespace won't change it's position (0) or value (NB the start end would have changed though)
    const codeWithExtraStartWhitespace = '\n\n\n' + code
    const ast2 = parse(codeWithExtraStartWhitespace)
    if (err(ast2)) throw ast2
    const { nonCodeMeta: nonCodeMeta2 } = ast2
    expect(nonCodeMeta2.nonCodeNodes[0]?.[0].value).toStrictEqual(
      nonCodeMetaInstance.value
    )
    expect(nonCodeMeta2.nonCodeNodes[0]?.[0].start).not.toBe(
      nonCodeMetaInstance.start
    )
  })
  it('comments nested within a block statement', () => {
    const code = `const mySketch = startSketchAt([0,0])
  |> lineTo([0, 1], %, $myPath)
  |> lineTo([1, 1], %) /* this is
      a comment
      spanning a few lines */
  |> lineTo([1,0], %, $rightPath)
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
      start: 92,
      end: 149,
      moduleId: 0,

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
      '  |> lineTo([0, 1], %, $myPath)',
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
      start: 113,
      end: 126,
      moduleId: 0,

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
      moduleId: 0,

      argument: {
        type: 'CallExpression',
        start: 15,
        end: 26,
        moduleId: 0,

        callee: {
          type: 'Identifier',
          start: 15,
          end: 18,
          moduleId: 0,
          name: 'min',
        },
        arguments: [
          {
            type: 'Literal',
            start: 19,
            end: 20,
            moduleId: 0,
            value: 4,
            raw: '4',
          },
          {
            type: 'Literal',
            start: 22,
            end: 25,
            moduleId: 0,
            value: 100,
            raw: '100',
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
      moduleId: 0,

      callee: {
        type: 'Identifier',
        start: 14,
        end: 17,
        moduleId: 0,
        name: 'min',
      },
      arguments: [
        {
          type: 'Literal',
          start: 18,
          end: 21,
          moduleId: 0,
          value: 100,
          raw: '100',
        },
        {
          type: 'BinaryExpression',
          operator: '+',
          start: 23,
          end: 39,
          moduleId: 0,

          left: {
            type: 'Literal',
            value: 1,
            raw: '1',
            start: 23,
            end: 24,
            moduleId: 0,
          },
          right: {
            type: 'CallExpression',
            start: 27,
            end: 39,
            moduleId: 0,

            callee: {
              type: 'Identifier',
              start: 27,
              end: 33,
              moduleId: 0,
              name: 'legLen',
            },
            arguments: [
              {
                type: 'Literal',
                start: 34,
                end: 35,
                moduleId: 0,
                value: 5,
                raw: '5',
              },
              {
                type: 'Literal',
                start: 37,
                end: 38,
                moduleId: 0,
                value: 3,
                raw: '3',
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
  const code = 'xLineTo(segEndX(seg02) + 1, %)'
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
        end: 26,
        moduleId: 0,

        left: {
          type: 'CallExpression',
          start: 8,
          end: 22,
          moduleId: 0,

          callee: {
            type: 'Identifier',
            start: 8,
            end: 15,
            moduleId: 0,
            name: 'segEndX',
          },
          arguments: [
            {
              type: 'Identifier',
              start: 16,
              end: 21,
              moduleId: 0,
              name: 'seg02',
            },
          ],
          optional: false,
        },
        right: {
          type: 'Literal',
          value: 1,
          raw: '1',
          start: 25,
          end: 26,
          moduleId: 0,
        },
      },
      { type: 'PipeSubstitution', start: 28, end: 29, moduleId: 0 },
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
    expect(error.msg).toBe('Unexpected token: (')
    expect(error.sourceRanges).toEqual([[27, 28, 0]])
  })
})
